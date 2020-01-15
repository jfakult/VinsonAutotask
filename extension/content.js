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
	
	if (window.location.href.indexOf("/home/timeEntry") >= 0)
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
