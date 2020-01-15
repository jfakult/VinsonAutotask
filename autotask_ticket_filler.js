(function() {
    'use strict';

    /*  DONT CHANGE THESE THINGS  */
    // GLOBALS
    var issueTypeList = {
        "CREATIVE_SERVICES": 1,
        "DATA_SERVICES":     2,
        "END_USER_DEVICES":  3,
        "INFRASTRUCTURE":    4,
        "MONITORING_ALERT":  5,
        "VINSON_USE_ONLY":   6
    }

    var queueList = {
        "APPLE_CLIENTS":        1,
        "CABLING":              2,
        "CLIENT_PORTAL":        3,
        "CREATIVE_SERVICES":    4,
        "EPIPHANY_INTERNAL":    5,
        "ESOC":                 6,
        "FIELD_SERVICES_QUEUE": 7,
        "GRID_SERVICES_QUEUE":  8,
        "MONITORING_ALERT":     9,
        "POST_SALE":            10,
        "QSIT":                 11,
        "RECURRING_TICKETS":    12,
        "REMOTE_RESOLUTION":    13,
        "RMM_CLIENT_PORTAL":    14,
        "RMM_MONITOR_TICKETS":  15,
        "SAMPLE_SCHOOLS":       16
    }

    var sourceList = { // Autotask defaults to 3 so this list is not currently implemented
        "OTRS": 1,
        "Phone": 2,
        "In_Person_Onsite": 3,
        "Email": 4,
        "Monitoring_Alert": 5,
        "Web_Portal": 6,
        "Voice_Mail": 7,
        "Verbal": 8,
        "Website": 9,
        "Insourced": 10,
        "Client_Portal": 11,
        "QSIT": 12
    }

    var dataServicesSubIssueList = {
        "ACTIVE_DIRECTORY": 1,
    	"ANTI-VIRUS": 2,
    	"BACKUPS": 3,
    	"DATA_STORAGE": 4,
    	"DATABASES": 5,
    	"GOOGLE_APPS": 6,
    	"GROUP_POLICY": 7,
    	"LEARNING_MANAGEMENT SYSTEM": 8,
    	"MOBILE_DEVICE MANAGEMENT TOOLS": 9,
    	"MS_OFFICE": 10,
    	"OTHER": 11,
    	"OTHER_3RD PARTY APPLICATIONS": 12,
    	"POS_SOFTWARE": 13,
    	"PURCHASING_": 14,
    	"SMARTBOARD_SOFTWARE": 15,
    	"STATE_TESTING SOFTWARE": 16,
    	"STUDENT_INFORMATION SYSTEM": 17,
    	"USER_ACCOUNT CREATION": 18,
	    "WEB_BROWSERS": 19
    }

    var endUserSubissuesList = {
        "AV_SYSTEMS": 1,
    	"CHROMEBOX/CHROMEBOOK": 2,
    	"DOCUMENT_CAMERAS": 3,
    	"INTERACTIVE_- TVS": 4,
    	"INTERACTIVE_EQUIPMENT": 5,
    	"LOCAL_PRINTERS": 6,
    	"MOBILE_DEVICES - ANDROID/IOS/ETC": 7,
    	"NETWORK_PRINTERS": 8,
    	"OTHER": 9,
    	"PROJECTORS": 10,
    	"PURCHASING": 11,
    	"STAFF_- WORKSTATION - HARDWARE": 12,
    	"STAFF_- WORKSTATION - OS": 13,
    	"STUDENT_- WORKSTATION - HARDWARE": 14,
    	"STUDENT_- WORKSTATION - OS": 15,
    	"VIDEO_CONFERENCE EQUIPMENT": 16
    }

    var infrastructureSubIssuesList = {
        "CABLING": 1,
    	"CONTENT_FILTER": 2,
    	"NETWORK_MONITORING": 3,
    	"NETWORK_SECURITY": 4,
    	"NETWORK_SERVICES (DHCP, DNS, ETC)": 5,
    	"OTHER": 6,
    	"PRINT_SERVER": 7,
    	"PURCHASING": 8,
    	"SECURITY_CAMERAS / DVR": 9,
    	"SERVERS_- HARDWARE": 10,
    	"SERVERS_- OS - LINUX": 11,
    	"SERVERS_- OS - MAC": 12,
    	"SERVERS_- OS - WINDOWS": 13,
    	"SWITCHES_/ ROUTERS / FIREWALL / GATEWAY": 14,
    	"TELEPHONY": 15,
	    "WIRELESS_HARDWARE": 16
    }

    /* CHANGE THESE THINGS */

    // Change the following values to what you would like. These correspond to the text that will autofill into the text fields on the lefthand side
    var buildingText = "Main"
    var roomText = "N/A"
    var isStudentDevice = "No"
    var bestCompletionTime = "N/A"

    //These values correspond to the dropdown boxes. Find values from the above constants
    // There are too many subissues to keep track of. If yours is not a constant listed above, count which index your desired subissue is from the dropdown list on Autotask. Indexes start at 1 (because that first space in the dropdown is blank, that is index 0)
    // Note: If you mispell a variable here, javascript won't complain. It will just return undefined
    var issueType = issueTypeList.END_USER_DEVICES;
    var subIssueType = endUserSubissuesList.OTHER;
    var queue = queueList.FIELD_SERVICES_QUEUE;

    /* DONT CHANGE THESE THINGS */

    document.getElementsByName("UserDefinedFields[0]")[0].value = buildingText
    document.getElementsByName("UserDefinedFields[1]")[0].value = roomText
    document.getElementsByName("UserDefinedFields[2]")[0].value = isStudentDevice
    document.getElementsByName("UserDefinedFields[3]")[0].value = bestCompletionTime

    document.getElementsByClassName("ItemSet Standard")[5].getElementsByClassName("Text")[issueType].click() // End user devices

    var i1 = setInterval(function() {
        //(!document.getElementById("LoadingIndicator").classList.contains("active"))
        if (document.getElementsByClassName("ItemSet Standard")[6].getElementsByClassName("Text")[subIssueType] != undefined)
        {
            clearInterval(i1)

            loadOther()
        }
    }, 100);


    function loadOther()
    {
        document.getElementsByClassName("ItemSet Standard")[6].getElementsByClassName("Text")[subIssueType].click() // Other

        loadQueue()
    }

    function loadQueue()
    {
        document.getElementsByClassName("ItemSet Standard")[8].getElementsByClassName("Text")[queue].click() // Field Service Queue
    }
})();