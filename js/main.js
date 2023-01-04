Promise.all([
	new Promise(r => createViewModel().then(r))
]).then(_ => importTemplatesListToHead(["templates-import"]))
  .then(_ => ko.applyBindings(viewModel))
  .catch(function(e){
	  console.log(e);
	  ko.cleanNode(document.body);
  });