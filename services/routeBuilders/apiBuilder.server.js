function createActionApiRoute(config, handler) {
  const action = async (request) => {
    try {
      let body;
      if (request.method === 'POST') {
        const contentType = request.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          body = await request.json();
        }
      }

      // Simple validation using the provided zod schema
      if (config.body) {
        body = config.body.parse(body);
      }

      // Mock authentication object
      const authentication = {
        userId: 'test-user-id',
      };

      // Call the handler
      const result = await handler({ body, authentication });
      
      return result;
    } catch (error) {
      console.error('API Route Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  const loader = action; // For simplicity, use the same handler

  return { action, loader };
}

module.exports = { createActionApiRoute };