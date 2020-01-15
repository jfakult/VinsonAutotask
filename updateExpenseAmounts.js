var milesThreshold = 40
var dollarsPerMile = 0.42
var minValueBeforePayment = milesThreshold * dollarsPerMile

function updateReimbursementValues()
{
	var table = document.querySelector(".grid table")
	if (table == undefined)
	{	
		console.log("No table found")
		return
	}

	var rows = table.children[1].getElementsByTagName("tr")

	if (rows.length == 0) return
	//rows.append  ???
	
	var dayName = rows[0].children[0].innerText
	var dayStartIndex = 0
	var reimbursementSum = 0
	var daySum = 0
	for (var i = 0; i < rows.length; i++)
	{
		var currentDay = rows[i].children[0].innerText
	
		if (currentDay == dayName && (rows[i].getAttribute("id") != "TotalRow"))
		{
			var dayValue =  parseFloat(rows[i].children[8].innerText.replace("$", ""))
			daySum += dayValue
		}
		else
		{
			var dayReimbursement = Math.max(0, daySum - minValueBeforePayment)
			reimbursementSum += dayReimbursement
			for (var j = dayStartIndex; j < i; j++)
			{
				var oldValue = parseFloat(rows[j].children[8].innerText.replace("$", ""))
				var proportionalAmount = oldValue / daySum
		
				rows[j].children[10].innerHTML = "$" + (dayReimbursement * proportionalAmount).toFixed(2)
			}
	
			dayStartIndex = i
			dayName = currentDay
			try
			{
				daySum = parseFloat(rows[i].children[8].innerText.replace("$", ""))
			}
			catch(e){}
		}
		
		if (rows[i].getAttribute("id") == "TotalRow") // Once we move past the last expense entry and into the total row
			break
	}

	var totalRow = rows[rows.length - 2]
	var amountRow = rows[rows.length - 1]
	
	totalRow.children[3].innerHTML = "$" + reimbursementSum.toFixed(2)
	amountRow.children[1].innerHTML = "$" + reimbursementSum.toFixed(2)
}

updateReimbursementValues()
