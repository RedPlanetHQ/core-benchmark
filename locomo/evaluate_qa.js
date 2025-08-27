#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * LOCOMO Q&A Evaluation Script
 * Evaluates question answering against ingested LOCOMO conversations
 * Assumes conversations are already ingested via ingest_conversations.js
 */

class LocomoEvaluator {
  constructor(baseUrl = "http://localhost:3033") {
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: `Bearer ${process.env.API_KEY}`,
    };
    this.results = [];

    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: this.headers,
    });
  }

  async makeRequest(endpoint, data) {
    try {
      const response = await this.axios.post(endpoint, data, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error(`No response received: ${error.message}`);
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }
  async searchMemory(question, conversationId = null) {
    try {
      const response = await this.makeRequest("/api/v1/search", {
        query: question,
      });

      return response;
    } catch (error) {
      console.error("Search error:", error.message);
      return { results: [] };
    }
  }

  async answerQuestion(question) {
    try {
      const response = await this.makeRequest("/api/v1/qa", {
        question: question,
      });

      return response;
    } catch (error) {
      console.error("Q&A API error:", error.message);
      return {
        question: question,
        generated_answer: "Error: Could not generate answer",
      };
    }
  }

  async evaluateAnswer(question, standardAnswer, generatedAnswer) {
    const response = await this.makeRequest("/api/v1/evaluate", {
      question,
      standard_answer: standardAnswer,
      generated_answer: generatedAnswer,
    });

    return {
      label: response.label,
      reasoning: response.reasoning,
      matchRatio: response.matchRatio,
      evaluationMethod: response.method,
    };
  }

  async evaluateQuestion(question, expectedAnswer, evidence, conversationId, category) {
    // NEW: Get generated answer from Q&A API
    const qaResponse = await this.answerQuestion(question);
    const generatedAnswer = qaResponse.generated_answer || "";

    // NEW: Evaluate the generated answer against the expected answer
    const evaluation = await this.evaluateAnswer(
      question,
      expectedAnswer.toString(),
      generatedAnswer
    );

    return {
      question,
      expectedAnswer,
      evidence,
      category,
      conversationId,
      generatedAnswer: generatedAnswer,
      evaluationResult: evaluation.label,
      evaluationReasoning: evaluation.reasoning,
      evaluationMethod: evaluation.evaluationMethod,
    };
  }

  async evaluateConversation(conversation, conversationId) {
    console.log(`Evaluating conversation ${conversationId}...`);

    const batchSize = 15; // Process 15 questions concurrently
    const qaResults = [];
    const totalQuestions = conversation.qa.length;
    let processed = 0;

    console.log(`Processing ${totalQuestions} questions in batches of ${batchSize}...`);

    for (let i = 0; i < totalQuestions; i += batchSize) {
      const batch = conversation.qa.slice(i, i + batchSize);
      const batchStartIndex = i;

      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalQuestions / batchSize)} (questions ${i + 1}-${Math.min(i + batchSize, totalQuestions)})`
      );

      // Create promises for the current batch
      const batchPromises = batch.map(async (qa, batchIndex) => {
        if (qa.category === 5) return null;
        const questionIndex = batchStartIndex + batchIndex;
        console.log(qa.question);
        try {
          const result = await this.evaluateQuestion(
            qa.question,
            qa.answer,
            qa.evidence,
            conversationId,
            qa.category
          );
          return { result, index: questionIndex };
        } catch (error) {
          console.error(`Error evaluating question ${questionIndex + 1}:`, error.message);
          return { error: error.message, index: questionIndex, qa };
        }
      });

      // Process batch concurrently
      const batchResults = await Promise.allSettled(batchPromises);

      // Process results from this batch
      batchResults.forEach((promiseResult) => {
        if (promiseResult.status === "fulfilled") {
          const value = promiseResult.value;
          if (value === null) return; // Skip category 5 questions
          const { result, error, index, qa } = value;
          if (result) {
            qaResults.push(result);
          } else if (error) {
            // Add a placeholder result for failed evaluations
            qaResults.push({
              question: qa.question,
              expectedAnswer: qa.answer ? qa.answer.toString() : qa.adversarial_answer.toString(),
              evidence: qa.evidence,
              category: qa.category,
              conversationId,
              error: error,
              generatedAnswer: "Error: Evaluation failed",
              evaluationResult: "ERROR",
              evaluationReasoning: `Evaluation failed: ${error}`,
              matchRatio: 0,
              evaluationMethod: "error",
            });
          }
        } else {
          console.error(`Batch promise rejected:`, promiseResult.reason);
        }
      });

      processed += batch.length;
      console.log(`  Completed ${processed}/${totalQuestions} questions`);

      // Save results periodically (every batch or ~15 questions)
      console.log(`Saving intermediate results...`);
      this.saveResults();

      // break;
    }

    console.log(`Completed evaluation of ${totalQuestions} questions`);
    return qaResults;
  }

  async runEvaluation() {
    console.log("Starting LOCOMO Q&A evaluation...");

    // Load LOCOMO dataset
    const dataPath = path.join(__dirname, "locomo10.json");
    const conversations = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    console.log(`Loaded ${conversations.length} conversations for evaluation`);

    // Evaluate each conversation
    for (let i = 0; i < conversations.length; i++) {
      const conversation = conversations[i];
      const conversationId = `locomo_${i + 1}`;

      if (i === 9) {
        try {
          const results = await this.evaluateConversation(conversation, conversationId);
          this.results.push({
            conversationId,
            results,
            totalQuestions: conversation.qa.length,
          });
        } catch (error) {
          console.error(`Error evaluating conversation ${conversationId}:`, error.message);
        }
      }
    }

    // Save and summarize results
    this.saveResults();
    this.printDetailedSummary();
  }

  saveResults() {
    const resultsPath = path.join(__dirname, "evaluation_results.json");
    const timestamp = new Date().toISOString();

    const output = {
      timestamp,
      summary: this.calculateSummaryStats(),
      conversations: this.results,
    };

    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to ${resultsPath}`);
  }

  calculateSummaryStats() {
    const totalQuestions = this.results.reduce((sum, conv) => sum + conv.totalQuestions, 0);
    const questionsWithContext = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.hasContext).length,
      0
    );
    const questionsWithAnswerInContext = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.answerInContext).length,
      0
    );

    // NEW: Q&A evaluation statistics
    const questionsWithGeneratedAnswers = this.results.reduce(
      (sum, conv) =>
        sum +
        conv.results.filter(
          (r) => r.generatedAnswer && r.generatedAnswer !== "Error: Could not generate answer"
        ).length,
      0
    );
    const correctAnswers = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.evaluationResult === "CORRECT").length,
      0
    );
    const wrongAnswers = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.evaluationResult === "WRONG").length,
      0
    );
    const errorAnswers = this.results.reduce(
      (sum, conv) => sum + conv.results.filter((r) => r.evaluationResult === "ERROR").length,
      0
    );

    // Category breakdown
    const categoryStats = {};
    this.results.forEach((conv) => {
      conv.results.forEach((result) => {
        const cat = result.category || "unknown";
        if (!categoryStats[cat]) {
          categoryStats[cat] = {
            total: 0,
            withContext: 0,
            withAnswer: 0,
            withGenerated: 0,
            correct: 0,
            wrong: 0,
            errors: 0,
          };
        }
        categoryStats[cat].total++;
        if (result.hasContext) categoryStats[cat].withContext++;
        if (result.answerInContext) categoryStats[cat].withAnswer++;
        if (
          result.generatedAnswer &&
          result.generatedAnswer !== "Error: Could not generate answer" &&
          result.generatedAnswer !== "Error: Evaluation failed"
        ) {
          categoryStats[cat].withGenerated++;
        }
        if (result.evaluationResult === "CORRECT") categoryStats[cat].correct++;
        if (result.evaluationResult === "WRONG") categoryStats[cat].wrong++;
        if (result.evaluationResult === "ERROR") categoryStats[cat].errors++;
      });
    });

    return {
      totalQuestions,
      questionsWithContext,
      questionsWithAnswerInContext,
      contextRetrievalRate: ((questionsWithContext / totalQuestions) * 100).toFixed(1),
      answerFoundRate: ((questionsWithAnswerInContext / totalQuestions) * 100).toFixed(1),
      // NEW: Q&A evaluation metrics
      questionsWithGeneratedAnswers,
      correctAnswers,
      wrongAnswers,
      errorAnswers,
      qaSuccessRate:
        totalQuestions > 0
          ? ((questionsWithGeneratedAnswers / totalQuestions) * 100).toFixed(1)
          : "0.0",
      answerAccuracyRate:
        questionsWithGeneratedAnswers > 0
          ? ((correctAnswers / questionsWithGeneratedAnswers) * 100).toFixed(1)
          : "0.0",
      categoryBreakdown: categoryStats,
    };
  }

  printDetailedSummary() {
    const stats = this.calculateSummaryStats();

    console.log("\n=== LOCOMO EVALUATION RESULTS ===");
    console.log(`Total conversations: ${this.results.length}`);
    console.log(`Total questions: ${stats.totalQuestions}`);
    console.log(
      `Questions with retrieved context: ${stats.questionsWithContext}/${stats.totalQuestions} (${stats.contextRetrievalRate}%)`
    );
    console.log(
      `Questions with answer in context: ${stats.questionsWithAnswerInContext}/${stats.totalQuestions} (${stats.answerFoundRate}%)`
    );

    console.log("\n=== Q&A EVALUATION RESULTS ===");
    console.log(
      `Questions with generated answers: ${stats.questionsWithGeneratedAnswers}/${stats.totalQuestions} (${stats.qaSuccessRate}%)`
    );
    console.log(
      `Correct answers: ${stats.correctAnswers}/${stats.questionsWithGeneratedAnswers} (${stats.answerAccuracyRate}%)`
    );
    console.log(`Wrong answers: ${stats.wrongAnswers}/${stats.questionsWithGeneratedAnswers}`);
    if (stats.errorAnswers > 0) {
      console.log(`Evaluation errors: ${stats.errorAnswers}/${stats.totalQuestions}`);
    }

    console.log("\n=== CATEGORY BREAKDOWN ===");
    Object.entries(stats.categoryBreakdown).forEach(([category, catStats]) => {
      const retrievalRate = ((catStats.withAnswer / catStats.total) * 100).toFixed(1);
      const qaRate =
        catStats.withGenerated > 0
          ? ((catStats.withGenerated / catStats.total) * 100).toFixed(1)
          : "0.0";
      const accuracyRate =
        catStats.withGenerated > 0
          ? ((catStats.correct / catStats.withGenerated) * 100).toFixed(1)
          : "0.0";

      console.log(`Category ${category}:`);
      console.log(`  Total questions: ${catStats.total}`);
      console.log(
        `  Context retrieval: ${catStats.withAnswer}/${catStats.total} (${retrievalRate}%)`
      );
      console.log(`  Generated answers: ${catStats.withGenerated}/${catStats.total} (${qaRate}%)`);
      console.log(
        `  Answer accuracy: ${catStats.correct}/${catStats.withGenerated} (${accuracyRate}%)`
      );
      if (catStats.errors > 0) {
        console.log(`  Evaluation errors: ${catStats.errors}/${catStats.total}`);
      }
    });

    console.log("\n=== PERFORMANCE INSIGHTS ===");
    const avgContextLength =
      this.results.reduce(
        (sum, conv) => sum + conv.results.reduce((s, r) => s + r.contextLength, 0),
        0
      ) / stats.totalQuestions;
    console.log(`Average context length: ${avgContextLength.toFixed(0)} characters`);

    const avgMatchRatio =
      this.results.reduce(
        (sum, conv) => sum + conv.results.reduce((s, r) => s + (r.matchRatio || 0), 0),
        0
      ) / stats.totalQuestions;
    console.log(`Average answer match ratio: ${avgMatchRatio.toFixed(3)}`);

    // Show evaluation method breakdown
    const evaluationMethods = {};
    this.results.forEach((conv) => {
      conv.results.forEach((result) => {
        const method = result.evaluationMethod || "unknown";
        evaluationMethods[method] = (evaluationMethods[method] || 0) + 1;
      });
    });

    console.log("\n=== EVALUATION SUMMARY ===");
    console.log(
      "This evaluation measures both retrieval performance and answer generation accuracy."
    );
    console.log("Generated answers are evaluated against gold standard answers.");

    console.log("\n=== EVALUATION METHODS USED ===");
    Object.entries(evaluationMethods).forEach(([method, count]) => {
      const percentage = ((count / stats.totalQuestions) * 100).toFixed(1);
      console.log(`${method}: ${count}/${stats.totalQuestions} (${percentage}%)`);
    });
  }
}

// Command line interface
if (require.main === module) {
  const evaluator = new LocomoEvaluator();
  evaluator.runEvaluation().catch(console.error);
}

module.exports = LocomoEvaluator;
