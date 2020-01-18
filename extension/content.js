/*
 * This is the content script for the Vinson Autotask API integration chrome extension
 * Essentially its purpose is to request javascript files from the node server hosting the API integration code
 * Further explanation of uses is explained in the server-side documentation
 */
insertAutomationHTML()

function insertAutomationHTML()
{
	if (window.location.href.indexOf("/timesheets/expenseReports") >= 0)
	{
		var script = document.createElement("script")
		script.setAttribute("src", "http://127.0.0.1:8001/api_response_helper.js")
		document.body.appendChild(script)

		var script2 = document.createElement("script")
		script2.setAttribute("src", "http://127.0.0.1:8001/updateExpenseAmounts.js")
		document.body.appendChild(script2)

	}
	
	if (window.location.href.indexOf("wrkEntryListView") >= 0)
	{
		var script = document.createElement("script")
		script.setAttribute("src", "http://127.0.0.1:8001/api_response_helper.js")
		document.body.appendChild(script)
	}

	if (window.location.href.indexOf("/TicketNew.mvc/Create") >= 0)
	{
		var script = document.createElement("script")
		script.setAttribute("src", "http://127.0.0.1:8001/autotask_ticket_filler.js")
		document.body.appendChild(script)
	}
}
