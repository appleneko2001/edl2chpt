// Credit to knowledge about EDL format: https://www.niwa.nu/2013/05/how-to-read-an-edl/
// Ref: https://github.com/MaximRouiller/edl-to-ytjs/
// Ref: https://github.com/thewoodknight/EDLtoYT/blob/
// Ref: https://github.com/suroh1994/twitch-marker-to-edl/blob/f6ce5a73bc1faab418cb57c47e2a3b90e8405d9f/edl.go

ko.bindingProvider.instance = new ko.secureBindingsProvider({
    attribute: "data-bind",
    globals: window,
    bindings: ko.bindingHandlers,
    noVirtualElements: false
});

ko.bindingHandlers.indeterminate = {
    update: function (element, valueAccessor) {
		const o = ko.unwrap(valueAccessor());
		switch(o){
			case null:
				element.indeterminate = true;
				break;
			default:
				element.indeterminate = false;
		}
    }
};

const _ = undefined;
const SMPTETimecodeRegex = /^(\d\d):(\d\d):(\d\d)(:|;|\.)(\d\d)$/;

const MarkerComparer = function(a,b){
  if (a.tc<b.tc)return -1;
  if (a.tc>b.tc)return 1;
  return 0;
}

const CardViewModel = function(title, text, dismiss){
	const self = this;
	
	self.title = title;
	self.text = text;
	self.dismiss = dismiss;
}

// 01:10:10:10 -> 1 hour 10 mins 10 seconds 10 frames
// fr - 60 Hz
// Simple timecode parser
function parseTimecode(str, fr){
	const m = SMPTETimecodeRegex.exec(str);
	if (!m)throw new Error("Invalid Timecode.");
	const hours = parseInt(m[1]);
	const mins = parseInt(m[2]);
	const seconds = parseInt(m[3]);
	/* TODO: DropFrame support
	const isDf = m[4]!==":";
	const frames = parseInt(m[5]);*/
	const totalSeconds = hours * 3600 + mins * 60 + seconds;
	return totalSeconds;
}


//https://stackoverflow.com/questions/35969656/how-can-i-generate-the-opposite-color-according-to-current-color
function getContrastColor(hex) {
    if (hex.indexOf('#') === 0)hex = hex.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	// Instead of throw a error, use black instead((
    if (hex.length !== 6) return '#000000';
    var r = parseInt(hex.slice(0, 2), 16),
        g = parseInt(hex.slice(2, 4), 16),
        b = parseInt(hex.slice(4, 6), 16);
	return (r * 0.299 + g * 0.587 + b * 0.114) > 186
		? '#000000'
		: '#FFFFFF';
}

const TextReader = function(str){
	const self = this;
	let i = 0;
	self.index = () => i;
	self.length = str.length;
	self.read = function(){
		if(i+1>=length)return null;
		return str[++i];
	}
	self.readLine = function(){
		const a = i;
		const b = str.indexOf('\n', a);
		if(b===-1)return null;
		const line = str.substring(a,b);
		i = b+1;
		const r=line.lastIndexOf('\r');
		if(r===line.length-1)return line.slice(0,-1);
		return line;
	}
}

const OpenFileDialog = function(resolver, onSuccess, onFail, ext){
    function OnOpenFileInputChanged (e){
        const file = e.target.files[0];

        const reader = new FileReader();
        reader.onloadend = function (){
            const data = reader.result;
            const handler = function (resolve, reject){
                try{
                    resolver(data);
                    resolve();
                }
                catch (error){
                    reject(error);
                }
            };
            new Promise(handler)
                .then(onSuccess)
                .catch(onFail);
        }
        reader.readAsText(file);
    }

    const openFileInput = document.createElement("input");
    openFileInput.onchange = OnOpenFileInputChanged;
    openFileInput.type = "file";
    openFileInput.accept = ext;
    openFileInput.click();
    openFileInput.remove();
}

// A property parser regex
const propRegex = /(\w+):\s?(.+)/i;

/* Improve parser */
const EditDecisionItem = function(ts,info){
	const self=this;
	self.props={};
	self.props["tags"]=[];
	self.tags = () => self.props["tags"];
	ts.forEach(function(e,i){
		switch(i){
			case 0:return;//Focusing on capt groups only
			case 1:self.numEdit=e;return;
			case 2:self.srcName=e;return;
			case 3:return;// Unsupported, yet.
			case 4:self.action=e;return;
			case 5:self.srcIn=e;return;
			case 6:self.srcOut=e;return;
			case 7:self.masterIn=e;return;
			case 8:self.masterOut=e;return;
		}
	});
	info.forEach(function(e,i){
		switch(i){
			case 0:return;//Focusing on capt groups only
			case 1:{
				const trim=e.trim();
				if(trim==="")return;
				self.props["desc"]=trim;
			}return;
			default:{
				const m = propRegex.exec(e);
				switch(m[1]){
					case "C":self.props["tags"].push(m[2].trimEnd());return;
					case "M":self.props["name"]=m[2].trimEnd();return;
					default:/*console.log(`Unsupported property in number edit #${self.numEdit}: ${m[0]}`);*/return;
				}
			}
		}
	});
}

const EditDecisionList = function(data){
	const self=this;
	self.raw =()=>data;
	const timestampRegex = /(\d{3,4})\s+(\d{3,4})\s+(.)\s+(.)\s+(\d{2}:\d{2}:\d{2}:\d{2})\s(\d{2}:\d{2}:\d{2}:\d{2})\s(\d{2}:\d{2}:\d{2}:\d{2})\s(\d{2}:\d{2}:\d{2}:\d{2})/i;
	const detailsRegex = /(.*)\s?\|(C:.*)\s?\|(M:.*)\s?\|(D:.*)/i
	
	self.props = {};
	self.list = [];
	
	const r = new TextReader(data);
	let line="";
	
	const parseProp=function(str){
		if(str==="")return;
		const m = propRegex.exec(str);
		self.props[m[1].toLowerCase()]=m[2];
	}
	
	const parse = function(){
		let title=0;
		let top=true;
		let stage=0;
		let timestamp=undefined;
		let info=undefined;
		while((line=r.readLine())!==null){
			if(top){
				parseProp(line);
			}
			if(line===""){
				if(top)top=false;
				else {
					stage=0;
					self.list.push(new EditDecisionItem(timestamp, info));
				}
				continue;
			}
			if(top)continue;
			switch(stage){
				case 0: timestamp=timestampRegex.exec(line);break;
				default: info=detailsRegex.exec(line);break;
			}
			stage++;
		}
	}
	parse();
}

const MarkerViewModel = function(viewModel,edi){
	const self = this;
	
	self.id = ko.observable(edi.numEdit);
	self.time = ko.observable(edi.srcIn);
	self.tags = ko.observableArray();
	self.text = ko.observable(edi.props["name"]);
	self.desc = ko.observable(edi.props["desc"]);
	
	self.anyEnabledTags = () => self.tags().some(a => a.enabled())
	
	edi.props["tags"].forEach(function(tag){
		const e = viewModel.processTag(tag);
		self.visible = e.enabled;
		self.tags.push(e);
	});
}

const TimelineViewModel = function(edi){
	const self = this;
	
	self.offset = ko.observable("01:00:00:00");
	self.framerate = ko.observable(60);
	self.selectedAll = ko.observable(true);
	self.selectionList = ko.observableArray();
	self.tagFilter = ko.observableArray();
	self.markers = ko.observableArray();
	self.counts = ko.observable(0);
	self.resultText = ko.observableArray();
	
	self.selectedAll.subscribe(a => onUpdateSelection(a,_,_));
	self.selectionList.subscribe(a => onUpdateSelection(_,a,_));
	self.tagFilter.subscribe(a => onUpdateSelection(_,_,a));
	
	function onUpdateSelection(sAll, s, t){
		const sL = self.selectionList().map(x => x);
		const f = self.markers().filter(a => a.anyEnabledTags());
		const fids = f.map(x => x.id());
		const sel = fids.every(e => sL.indexOf(e) != -1) ? true : 
			sL.length === 0 ? false : null;
		self.counts(f.length);
		self.selectedAll(sel);
		self.result = f.filter(a => sL.indexOf(a.id()) != -1);
	}
	
	// TODO:
	function onUpdateList(){
		
	}
	
	// Apply EDL elements as Whole timeline
	self.applyTimelineByEdl = function(edl){
		edl.list.forEach(e=>addTimelineInternal(e));
	}
	
	self.addTimeline = function(){
		// TODO
	}
	
	self.processTag = function(tag){
		const appendTag = function(txt, color){
			var match = ko.utils.arrayFirst(self.tagFilter(),a=>a.txt===txt);
			if(match) return match;
			
			const tag={txt:txt};
			if(color!==undefined){
				tag["color"]=color;
				tag["contrast"]=getContrastColor(color);
			}
			tag["enabled"]=ko.observable(true);
			tag["opacity"]=ko.observable(1);
			tag["click"]= ()=>{
				const v = !tag["enabled"]();
				tag["enabled"](v);
				tag["opacity"](v ? 1 : 0.2);
			};
			tag["enabled"].subscribe(onUpdateSelection);
			self.tagFilter.push(tag);
			return tag;
		}
		
		switch(tag.toLowerCase()){
			// Davinci Resolve Marker colors
			case "resolvecolorblue": return appendTag(tag,"#007FE3");
			case "resolvecolorcyan": return appendTag(tag,"#00CED0");
			case "resolvecolorgreen": return appendTag(tag,"#00AD00");
			case "resolvecoloryellow": return appendTag(tag,"#F09D00");
			case "resolvecolorred": return appendTag(tag,"#E12401");
			case "resolvecolorpink": return appendTag(tag,"#FF44C8");
			case "resolvecolorpurple": return appendTag(tag,"#9013FE");
			case "resolvecolorfuchsia": return appendTag(tag,"#C02E6F");
			case "resolvecolorrose": return appendTag(tag,"#FFA1B9");
			case "resolvecolorlavender": return appendTag(tag,"#A193C8");
			case "resolvecolorsky": return appendTag(tag,"#92E2FD");
			case "resolvecolormint": return appendTag(tag,"#72DB00");
			case "resolvecolorlemon": return appendTag(tag,"#DCE95A");
			case "resolvecolorsand": return appendTag(tag,"#C4915E");
			case "resolvecolorcocoa": return appendTag(tag,"#6E5143");
			case "resolvecolorcream": return appendTag(tag,"#F5EBE1");
			// 
			default: return appendTag(tag);
		}
	}
	
	self.exportAsYtChapters = function (){
		if(self.result === undefined)
			onUpdateSelection();
		const offset = parseTimecode(self.offset());
		self.result.forEach(e => e.tc = parseTimecode(e.time()));
		const r = self.result.sort(MarkerComparer);
		const rList = [];
		
		r.forEach(e => {
			const tc = e.tc - offset;
			if(tc < 0) throw new Error("Timecode shouldn't be negative!!! Definitely somewhere wrong, for example, offset are too large!!!");
			const t_s = Math.floor(tc%60);
			const t_m = Math.floor(tc/60)%60;
			const t_h = Math.floor(tc/3600)
			function c (n) {
				return n.toString().padStart(2,'0');
			}
			const t = t_h === 0 ? `${t_m}:${c(t_s)}` : `${t_h}:${c(t_m)}:${c(t_s)}`;
			rList.push(`${t} ${e.text()}`);
		});
		
		self.resultText(rList);
		location.href="#resultText";
	}
	
	const addTimelineInternal = function (e){
		self.selectionList.push(e.numEdit);
		self.markers.push(new MarkerViewModel(self,e));
	}
	
	if(edi !== undefined){
		console.log("Applying View Model");
		self.applyTimelineByEdl(edi);
		self.title=edi.props["title"];
	}
	
	onUpdateSelection();
}

const AppViewModel = function(){
	const self = this;
	
	self.privacyNotice = ko.observable(
	new CardViewModel("Notice", 
	["This application doesn't use any backend to work with.",
	"All procedures will be completed on your device.",
	"Do not worry about data leaking."], 
	() => self.privacyNotice(undefined)));
	self.privacyNotice(undefined);
	
	self.timeline = ko.observable(_);
	
	self.popupOpenEdlFile = function(){
		const dialog = new OpenFileDialog((d) => {
			const m = new EditDecisionList(d);
			console.log(`Parsed EDL file:`,m);
			self.timeline(new TimelineViewModel(m));
		}, _, _, ".edl");
	}
	
	self.openEdlFile = function(file){
		new Promise((resolve,reject) => {
			try{
				const reader = new FileReader();
				reader.onloadend = function(ev){
					const fileData = reader.result;
					if(reader.result===null)return;
					const data = new EditDecisionList(fileData);
					console.log(`Parsed EDL file:`,data);
					self.timeline(new TimelineViewModel(data));
					resolve();
				};
				reader.readAsText(file);
			}
			catch(error){
				reject(error);
			}
		})
	}
	
	self.clearTimeline = function(){
		// TODO: ask user before perform action
		self.timeline(_);
	}
	
	self.exportAsYtChapters = function(){
		const i = self.timeline();
		if(i === _)
			return;
		i.exportAsYtChapters();
	}
};

let viewModel = null;

const createViewModel = async function(){
	const vm = viewModel = new AppViewModel();
}
  
const dropZone = document.querySelector("#ui-drop-zone");

dropZone.addEventListener("dragover", (ev) => {
	if(viewModel===undefined)
		return;
	
	ev.preventDefault();
	const svc = ev.dataTransfer;
	if(svc.items.length===0)
		dropZone.innerText="No files.";
	else if(svc.items.length>1)
		dropZone.innerText="Multiple files are not supported.";
	else
		dropZone.innerText="Drop your *.EDL file here to load!";
});
dropZone.addEventListener("drop", (ev) => {
	if(viewModel===undefined)
		return;
	
	ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
	const svc = ev.dataTransfer;
	if(svc.files.length===0)
		return;
	if(svc.files.length===1){
		const file = svc.files[0];
		const c = file.name.toLowerCase().endsWith(".edl");
		if(c===0)
			return;
		viewModel.openEdlFile(file);
	}
});

document.ondragover = function(){
	dropZone.setAttribute("visible",0);
}

document.ondrop = function(){
	dropZone.removeAttribute("visible");
}