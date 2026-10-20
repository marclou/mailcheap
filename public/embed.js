// MailCheap's signup form for your site: put this tag where the form goes.
// <script src="https://<server>/embed.js" data-form="<newsletter id>" async></script>
(function () {
	var script = document.currentScript;
	if (!script || !script.getAttribute("data-form")) return;
	var origin = new URL(script.src).origin;
	var frame = document.createElement("iframe");
	frame.src = origin + "/embed/" + encodeURIComponent(script.getAttribute("data-form"));
	frame.title = "Newsletter signup";
	frame.setAttribute("scrolling", "no");
	frame.style.cssText = "display:block;width:100%;max-width:" + (script.getAttribute("data-width") || "480px") + ";height:50px;border:0;overflow:hidden;background:transparent";
	script.parentNode.insertBefore(frame, script.nextSibling);
	window.addEventListener("message", function (event) {
		var data = event.data;
		if (event.origin !== origin || event.source !== frame.contentWindow || !data || data.type !== "mailcheap:height") return;
		if (data.height > 0) frame.style.height = Math.ceil(data.height) + "px";
	});
})();
