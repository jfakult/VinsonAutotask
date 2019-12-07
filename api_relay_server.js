var http = require("http");
var request = require('request');
var apiTools = require("./api_helpers.js")

http.createServer(function (request, response)
{
	// Send the HTTP header 
	// HTTP Status: 200 : OK
	// Content Type: text/plain
   	response.writeHead(200, {'Content-Type': 'text/html'});

	var ticketData = apiTools.buildTicketsQueryRequest(function(apiResponse) {
		response.write(apiResponse.toString())
		response.end()
	})
}).listen(8001);


console.log('Server running at http://127.0.0.1:8001/');
