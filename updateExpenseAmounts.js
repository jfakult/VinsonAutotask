/*
 * This is a script that can be requested by the vinson-autotask integration chrome extension
 * Its only purpose is to read the amount values on an expense report, and for each day, display the reimbursement amount after
 * accounting for the first *milesThreshold* miles driven for the day
 */

var milesThreshold = 40
var dollarsPerMile = 0.42
var minValueBeforePayment = milesThreshold * dollarsPerMile

function updateReimbursementValues()
{
	var table = document.querySelector(".grid table")

	// Make sure we are loaded up in the correct iFrame
	if (table == undefined)
	{	
		console.log("No table found")
		return
	}

	// children[1] grabs the tbody tag
	var rows = table.children[1].getElementsByTagName("tr")

	if (rows.length == 0) return

	// We will be iterating over every expense entry for the given expense report.
	// These variables will keep track of per-day values, so we can account for total miles driven each day (instead of for each expense entry)
	var dayName = rows[0].children[0].innerText
	var dayStartIndex = 0
	var reimbursementSum = 0
	var daySum = 0

	for (var i = 0; i < rows.length; i++)
	{
		var currentDay = rows[i].children[0].innerText
	
		// If the new expense entry is in the same day as the previous loop
		if (currentDay == dayName && (rows[i].getAttribute("id") != "TotalRow"))
		{
			var dayValue =  parseFloat(rows[i].children[8].innerText.replace("$", ""))
			daySum += dayValue
		}
		else  // This entry is the start of a new day, update day values and reset tracking variables
		{
			var dayReimbursement = Math.max(0, daySum - minValueBeforePayment)
			reimbursementSum += dayReimbursement

			// Go back and iterate over the trips from day we just finished tracking
			// For each entry adjust the amount owed to reflect the proportion of that trip's value as compared to the day's total reimbursement amount
			for (var j = dayStartIndex; j < i; j++)
			{
				var oldValue = parseFloat(rows[j].children[8].innerText.replace("$", ""))
				var proportionalAmount = oldValue / daySum
		
				// Update value in table
				rows[j].children[10].innerHTML = "$" + (dayReimbursement * proportionalAmount).toFixed(2)
			}
	
			// Update tracking variables
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
	
	// Update "total" values on last row
	totalRow.children[3].innerHTML = "$" + reimbursementSum.toFixed(2)
	amountRow.children[1].innerHTML = "$" + reimbursementSum.toFixed(2)
}

updateReimbursementValues()
