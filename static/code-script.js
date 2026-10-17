"use strict";
let globals = {
    conversationId:
        $("body").attr("data-conversation-id").trim() ? $("body").attr("data-conversation-id").trim() : null
    ,
    currentLanguage: "html",
    pythonSessions: {},
};
/* You've probably noticed something- there are two copies of the conversation id; one in JavaScript and one in HTML.
The HTML one is only for Jinja to manipulate at the load of the page. Afterward, JavaScript handles the rest. I didn't put Jinja directly in JavaScript because then my IDE throws an error; it's not native JavaScript syntax. And my IDE's Jinja mode is nowhere near as excellent as its HTML mode.
*/
function configAceSession(session) {
    session.setOptions({
        tabSize: 4,
        useSoftTabs: true,
        wrap: false,
    });
}
const editor = ace.edit("editor");
const mainPySession = ace.createEditSession("", "ace/mode/python");
const htmlSession = ace.createEditSession("", "ace/mode/html");
configAceSession(htmlSession);
configAceSession(mainPySession);
htmlSession.setValue($("body").attr("data-html-program"));
(function () {
    const rawJSON = $("body").attr("data-python-program");
    if (!rawJSON) {
        return;
    }
    const obj = JSON.parse(rawJSON);
    for (const moduleName in obj) {
        const program = obj[moduleName];
        const $module = $("<span class='python-module'></span>").text(moduleName + ".py");
        if (moduleName === "main") {
            $module.attr("id", "main-python-module");
            mainPySession.setValue(program);
        } else {
            $module.append("<span class='delete-python-module'></span>");
            $("#python-module-container").append($module);
            const newSession = ace.createEditSession(program, "ace/mode/python");
            configAceSession(newSession);
            globals.pythonSessions[moduleName] = newSession;
            newSession.on("change", saveProgram);
        }
    }
    $(".python-stuff").hide();
    if ($("#python-module-container").children().length > 1) {
        $("#main-python-module").addClass("selected-python-module");
    }
    const selected = localStorage.getItem("language-selected");
    if (!selected || selected === "html") {
        setTimeout(showPreview, 100);
    } else if (selected === "python") {
        setTimeout(() => {
            $("#language-selection").val("python")
            $("#language-selection").trigger("change")
        }, 0)
    }
})();
editor.setSession(htmlSession);
editor.setTheme("ace/theme/dawn");
editor.setOptions({
    fontSize: "16px",
    fontFamily: "Courier New, Courier, monospace",
    showPrintMargin: true,
    wrap: false,
    useSoftTabs: true,
});
editor.resize();
globals.pythonSessions["main"] = mainPySession;
/*
Normally, when a keyboard user tabs inside the ace editor, they can't get out! Ace treats it like they're just adding an indent. That's why this keyboard shortcut exists.
*/
editor.commands.addCommand({
    name: "escapeEditor",
    bindKey: { "win": "Esc", "mac": "Esc" },
    exec: function () {
        $("#html-preview")[0].focus();
    }
});
function debounce(func, timeout) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}
function showPreview() {
    $("#error-div").hide();
    $("#error-div p").text("");
    const errorScript = `
    <script>
    window.onerror = function (message, source, lineno, colno, error) {
    if (message === "Script error." && lineno === 0) {
        /* An external library did it, but we don't know what it is. */
        window.parent.postMessage({'message':"Cross-Origin Script Error: A script loaded from an external CDN crashed, but the error details are hidden for security reasons. To show the error, add 'crossorigin=\\"anonymous\\"' to your <script> tag.", 'reason':"JS_ERROR_MESSAGE"}, "*");
    } else {
        window.parent.postMessage({'message':\`\${message}: at \${source}. At line \${lineno} column \${colno}.\`, 'reason':"JS_ERROR_MESSAGE"}, "*");
    };
    }; 
    window.onunhandledrejection = function (event) {
    if (!event.reason || /Script error\\./i.test(event.reason)) {
        window.parent.postMessage({'message':"Cross-Origin Script Error: A script loaded from an external CDN crashed with an unhandled rejected Promise, but the error details are hidden for security reasons. To show the error, add 'crossorigin=\\"anonymous\\"' to your <script> tag.", 'reason':"JS_ERROR_MESSAGE"}, "*");
    } else {
        window.parent.postMessage({'message':"Unhandled promise rejection: " + event.reason, 'reason':"JS_ERROR_MESSAGE"}, "*");
    };
    }; 
    <\/script>
    `.replaceAll("\n", " ");
    // This script sends all errors directly to the main script, which will then show it to the user.
    const newValue = editor.getValue();
    $("#html-preview").attr("srcdoc", errorScript + "<base target='_blank'>" + newValue);
    // That way if the create a link then the <base> will redirect them to a new tab and not destroy the iframe.
    const previewTimeoutId = setTimeout(() => {
        $("#html-preview-container").append($("#html-preview").remove().attr("srcdoc", ""));
        $("#error-div p").text("Your code took too much time, so we halted it. That's all we know.");
        $("#error-div").show();
    }, 5000);
    $("#html-preview")[0].onload = function () {
        clearTimeout(previewTimeoutId);
    };
}
async function saveProgram() {
    const $p = $("#editor-above p");
    $p.css("--before-image-src", `url("${$p.attr("data-loading-icon")}")`);
    $p.text("Saving...");
    let payload;
    if (globals.currentLanguage === "html") {
        payload = editor.getValue();
    } else if (globals.currentLanguage === "python") {
        payload = {};
        for (const key in globals.pythonSessions) {
            const session = globals.pythonSessions[key];
            payload[key] = session.getValue();
        }
        console.info("Payload", payload);
    }
    await fetch("/api/save-program", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            code: payload,
            language: globals.currentLanguage,
        }),
    });
    $p.css("--before-image-src", `url("${$p.attr("data-saved-icon")}")`);
    $p.text("Saved!");
    editor.session.off("change", "programSavingUIDebouncer");
    editor.session.on("change", function programSavingUIDebouncer() {
        $p.css("--before-image-src", "none").text("");
    });
}
const editorOnChange = debounce(function () {
    if ($("#update-html-preview-checkbox")[0].checked && globals.currentLanguage === "html") {
        showPreview();
    }
    if ($("#autosave-program-checkbox")[0].checked) {
        saveProgram();
    }
}, 500);
mainPySession.on("change", saveProgram);
htmlSession.on("change", editorOnChange);
function showTour() {
    function endTour() {
        $(".tour-step").each((index, element) => element.close());
        $("body").removeClass("tour-step-1 tour-step-2 tour-step-3");
    }
    $(".skip-tour").on("click", endTour);
    $("#tour-step-1")[0].showModal();
    $("body").addClass("tour-step-1");
    $("#tour-step-1 .next-tour-step").off().one("click", () => {
        $("#tour-step-1")[0].close();
        $("#tour-step-2")[0].showModal();
        $("body").removeClass("tour-step-1").addClass("tour-step-2");
        $("#tour-step-2 .next-tour-step").off().one("click", () => {
            $("#tour-step-2")[0].close();
            $("#tour-step-3")[0].showModal();
            $("body").removeClass("tour-step-2").addClass("tour-step-3");
            $("#tour-step-3 .next-tour-step").off().one("click", () => {
                $("#tour-step-3")[0].close();
                $("body").removeClass("tour-step-3");
            });
        });
    });
};
$("#tour-start-button").on("click", showTour);
$("#language-selection").on("change", function (event) {
    const newVal = $(event.target).val();
    if (newVal === "python") {
        editor.setSession(mainPySession);
        $(".html-stuff, #error-div").hide();
        $(".python-stuff").show();
        globals.currentLanguage = "python";
        localStorage.setItem("language-selected", "python");
    } else if (newVal === "html") {
        editor.setSession(htmlSession);
        $(".python-stuff").hide();
        $(".html-stuff").show();
        globals.currentLanguage = "html";
        localStorage.setItem("language-selected", "html");
    }
});
$("#run-python-button").on("click", function () {
    const values = {};
    for (const sessionName in globals.pythonSessions) {
        values[sessionName + ".py"] = globals.pythonSessions[sessionName].getValue();
    }
    $("#python-preview")[0].contentWindow.postMessage({ modules: values, reason: "RUN_CODE" }, "*");
});
$("#create-python-module-button").on("click", function () {
    $("#create-python-module-dialog")[0].showModal();
});
$("#create-python-module-dialog form").on("submit", function () {
    event.preventDefault();
    const moduleName = $("#create-python-module-dialog form input").val();
    if (/[^a-zA-Z0-9_\-]/i.test(moduleName)) {
        alert("Please only include alphanumeric characters, '_', and '-' in your module names.");
        return;
    } else if (!moduleName) {
        alert("Please submit a module name.");
        return;
    }
    const session = ace.createEditSession("", "ace/mode/python");
    configAceSession(session);
    session.on("change", saveProgram);
    globals.pythonSessions[moduleName] = session;
    editor.setSession(session);
    $("#create-python-module-dialog form input").val("");
    $("#python-module-container").children().each((index, element) => $(element).removeClass("selected-python-module"));
    $("#python-module-container").append($("<span class='python-module'></span>").text(moduleName + ".py").addClass("selected-python-module").append("<span class='delete-python-module'></span>"));
    $("#create-python-module-dialog")[0].close();
    saveProgram();
});
$("#python-module-container").on("click", function (event) {
    if ($("#python-module-container").children().length <= 1) {
        return;
    }
    const $target = $(event.target);
    if ($target.hasClass("delete-python-module")) {
        const $module = $target.parent();
        if (!confirm(`Are you sure you want to delete ${$module.text()}? This action cannot be undone.`)) {
            return;
        }
        const session = globals.pythonSessions[$module.text().split(".py")[0]];
        if (editor.getSession() === session) {
            editor.setSession(mainPySession);
        }
        $("#main-python-module").addClass("selected-python-module");
        delete globals.pythonSessions[$module.text().split(".py")[0]];
        $("#python-preview")[0].contentWindow.postMessage({ moduleName: $module.text(), reason: "DELETE_MODULE", }, "*");
        $module.remove();
        saveProgram();
        return;
    }
    const $module = $target;
    const session = globals.pythonSessions[$module.text().split(".py")[0]];
    if (session == undefined) {
        console.warn("Session from python module not found!", $module, $module.text());
        return;
    }
    $("#python-module-container").children().each((index, element) => {
        $(element).removeClass("selected-python-module");
    });
    $module.addClass("selected-python-module");
    editor.setSession(session);
});
$("#autosave-program-checkbox").on("change", function () {
    if (this.checked) {
        $("#save-program-button").prop("disabled", true).attr("title", "Your program will automatically save, so there's no need to do it manually.");
    } else {
        $("#save-program-button").prop("disabled", false).attr("title", "");
    }
});
$("#update-html-preview-checkbox").on("change", function () {
    if (this.checked) {
        $("#update-html-preview-button").prop("disabled", true).attr("title", "The preview will automatically update, so there's no need to do it manually.");
    } else {
        $("#update-html-preview-button").prop("disabled", false).attr("title", "");
    }
});
$("#save-program-button").on("click", saveProgram);
$("#update-html-preview-button").on("click", showPreview);
window.addEventListener("message", function (event) {
    if (event.data.reason !== "JS_ERROR_MESSAGE") {
        return;
    }
    if (event.source !== $("#html-preview")[0].contentWindow) {
        console.warn("Received suspicious message from an iframe that doesn't match. Information: ", event);
        return;
    }
    const errorMessage = event.data.message;
    $("#error-div p").text(errorMessage);
    $("#error-div").show();
});
$("#close-error-div").on("click", function () {
    $("#error-div").hide();
    $("#error-div p").text("");
});
function addMessageToChat(message, isFromHuman) {
    const newEl = $(`
        <div class="message ${isFromHuman ? 'user-message' : 'ai-message'}"></div>
    `.trim());
    if (isFromHuman) {
        // The human likely didn't want to turn it to html.
        newEl.text(message);
    } else {
        // However, the ai definitely put the html entities on purpose.
        newEl.html(message);
    }
    newEl.appendTo("#messages-container");
    return newEl;
}
$("#message-input").on("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        // We want to submit it if they press enter, but add a newline like the default behavior if it is shift+enter.
        event.preventDefault();
        $("#message-form").trigger("submit");
    }
});
$("#message-form").on("submit", async function (event) {
    event.preventDefault();
    const value = $("#message-input").val();
    const container = $("#messages-container")[0];
    const $userMessage = addMessageToChat(value, true);
    $("#message-input").val("");
    // Scroll to the bottom automatically, to the end of the message.
    setTimeout(() => {
        container.scrollBy({
            top: container.scrollHeight,
            left: 0,
            behavior: "smooth",
        });
    }, 10);
    let program;
    if (globals.currentLanguage === "html") {
        program = editor.getValue();
    } else {
        program = {};
        for (const moduleName in globals.pythonSessions) {
            const session = globals.pythonSessions[moduleName];
            program[moduleName + ".py"] = session.getValue();
        }
    }
    $("<div class='message ai-message temporary'></div>").append(`<img src='${$("#loader-gif-preloader").attr("href")}'>`).appendTo("#messages-container");
    try {
        const rawResponse = await fetch("/api/chat", {
            method: $("#messages-container").children().length < 2 ? "POST" : "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: value, code: program, id: globals.conversationId, language: globals.currentLanguage }),
        });
        if (!rawResponse.ok) {
            throw new Error(`HTTP Error! Status: ${rawResponse.status}.`);
        }
        const response = await rawResponse.json();
        if (!response.message) {
            if (response.warning) {
                addMessageToChat("The message failed for an unknown reason. Please try again.", false);
                console.warn("Request failed because of " + response.warning);
                return;
            }
            throw new Error("Response empty.");
        }
        globals.conversationId = response.id;
        addMessageToChat(response.message, false);
        // Scroll again so that the AI message from the top is visible, so they can start reading.
        setTimeout(
            () => {
                container.scrollBy({
                    top: container.offsetHeight - $userMessage.outerHeight(true), // Since we earlier scrolled so that the user message is at the bottom, scroll the height of the container so that the message is now at the top.
                    left: 0,
                    behavior: "smooth",
                });
            }, 10
        );
    } catch (error) {
        console.error(error);
        addMessageToChat("The message failed for an unknown reason. Please try again.", false);
    } finally {
        $("#messages-container .ai-message.temporary").remove();
    }
});
$("#new-chat-button").on("click", async function () {
    $("#messages-container").empty();
    $("body").removeAttr("data-conversation-id");
    globals.conversationId = null;
    await fetch("/api/chat", {
        method: "DELETE"
    });
});
$("#logout-button").on("click", async function () {
    const rawResponse = await fetch("/api/logout", {
        method: "DELETE",
    });
    const response = await rawResponse.json();
    if (response.redirect) {
        window.location.href = response.link;
    }
});