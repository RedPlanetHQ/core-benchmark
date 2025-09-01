const axios = require("axios");

class SearchService {
  constructor(baseUrl = process.env.BASE_URL, apiKey = process.env.API_KEY) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;

    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
  }

  async search(query, options = {}) {
    try {
      console.log(`Searching for: "${query}"`);

      const response = await this.axios.post("/api/v1/search", {
        query: query,
        ...options,
      });

      // Handle the response from your search API
      // Assuming the API returns results in a format that we need to adapt
      const searchResults = response.data;

      // If the API response format is different, we might need to transform it
      // For now, assuming it returns episodes and facts or we need to adapt
      if (!searchResults.episodes && !searchResults.facts) {
        // If the response format is different, adapt it here
        // For example, if it returns a 'results' array, we could transform it:
        const episodes = searchResults.results || [];
        const facts = [];

        return {
          episodes: episodes,
          facts: facts,
        };
      }

      return searchResults;
    } catch (error) {
      console.error("Search API error:", error.response?.data || error.message);

      // Return empty results on error
      return {
        episodes: [],
        facts: [],
      };
    }
  }
}

module.exports = { SearchService };
