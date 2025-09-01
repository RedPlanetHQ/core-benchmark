function json(data, init = {}) {
  const responseInit = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers
    },
    ...init
  };

  return new Response(JSON.stringify(data), responseInit);
}

module.exports = { json };