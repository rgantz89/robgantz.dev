function handler(event) {
  var req = event.request;
  var host = req.headers.host ? req.headers.host.value : '';
  if (host !== 'robgantz.dev') {
    var qs = [];
    for (var k in req.querystring) {
      var v = req.querystring[k];
      if (v.multiValue) { for (var i = 0; i < v.multiValue.length; i++) { qs.push(k + '=' + v.multiValue[i].value); } }
      else { qs.push(v.value ? k + '=' + v.value : k); }
    }
    return { statusCode: 301, statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://robgantz.dev' + req.uri + (qs.length ? '?' + qs.join('&') : '') } } };
  }
  return req;
}
