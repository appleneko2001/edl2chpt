const importTemplatesToHead = async function (link){
    await importTemplatesToHeadCore(link.href);
}

const importTemplatesListToHead = async function (list){
    for (const id of list){
        const link = document.head.querySelector(`link#${id}`);
        await importTemplatesToHeadCore(link.href);
    }
}

const importTemplatesToHeadCore = async function (href){
    const templates = document.createElement('template');
    templates.innerHTML = await (await fetch(href)).text();

    const elements = Array.from(templates.content.children);

    for (const element of elements){
        if(element.tagName !== 'SCRIPT')
            continue;

        document.head.appendChild(element);
    }
}