/**
 * axios stub that blocks all external network requests.
 * Logs intercepted requests and returns empty responses.
 */

function createResponse(config) {
  return {
    data: {},
    status: 200,
    statusText: 'OK (blocked by stub)',
    headers: {},
    config: config || {},
    request: {},
  };
}

function logBlocked(method, url) {
  console.log(`[axios-stub] Blocked ${method.toUpperCase()} ${url}`);
}

async function axiosStub(config) {
  config = config || {};
  const method = (config.method || 'GET').toUpperCase();
  const url = config.url || config || '';
  logBlocked(method, url);
  return createResponse(config);
}

// HTTP method shortcuts
for (const method of ['get', 'delete', 'head', 'options']) {
  axiosStub[method] = async function (url, config) {
    logBlocked(method, url);
    return createResponse({ ...config, url, method });
  };
}
for (const method of ['post', 'put', 'patch']) {
  axiosStub[method] = async function (url, data, config) {
    logBlocked(method, url);
    return createResponse({ ...config, url, method, data });
  };
}

axiosStub.request = axiosStub;

axiosStub.create = function (defaults) {
  // Return a new instance that also blocks everything
  const instance = function (config) {
    return axiosStub({ ...defaults, ...config });
  };
  Object.assign(instance, axiosStub);
  instance.defaults = defaults || {};
  instance.interceptors = {
    request: { use() {}, eject() {}, clear() {} },
    response: { use() {}, eject() {}, clear() {} },
  };
  return instance;
};

axiosStub.defaults = {
  headers: { common: {}, get: {}, post: {}, put: {}, patch: {}, delete: {}, head: {} },
};

axiosStub.interceptors = {
  request: { use() {}, eject() {}, clear() {} },
  response: { use() {}, eject() {}, clear() {} },
};

axiosStub.isCancel = function () { return false; };
axiosStub.CancelToken = {
  source() {
    return { token: {}, cancel() {} };
  },
};
axiosStub.isAxiosError = function () { return false; };
axiosStub.all = Promise.all.bind(Promise);
axiosStub.spread = function (cb) { return function (arr) { return cb.apply(null, arr); }; };

// Support both default and named export patterns
axiosStub.default = axiosStub;

module.exports = axiosStub;
