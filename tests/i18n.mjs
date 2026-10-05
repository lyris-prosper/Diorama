// Every text the person sees exists in Chinese and English. Pure, offline: reads the source.
// Page: a Chinese string or JSX text must sit in t("中文", "English") / pick(lang)(…), in a branch on
// the language (lang === "en" ? … : …), or in a pair ({ zh, en }, { name, nameEn }, ["中文", "English"]).
// Server: an error the person may read is thrown with say(zh, en), or as a ProviderError with `en`.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';

const CJK=/[一-鿿]/;
const LATIN=/[A-Za-z]{2}/;
// Chinese values that are data, shown through a translation (pieceName, the 中 | EN switch).
const DATA=new Set(['中','书桌','床','柜子','椅子','沙发','家具']);
const page=[
  ...readdirSync('components/editor').filter(f=>f.endsWith('.tsx')).map(f=>'components/editor/'+f),
  'lib/catalog.ts','lib/photo.ts','lib/image.ts','lib/align-clean.ts','lib/local-vision.ts','lib/recognition.ts',
];

function textOf(node,sf){return node.getText(sf)}
function paired(node,sf){
  for(let p=node.parent;p;p=p.parent){
    if(ts.isCallExpression(p)){
      const callee=p.expression;
      if(ts.isIdentifier(callee)&&callee.text==='t')return true;
      if(ts.isCallExpression(callee)&&ts.isIdentifier(callee.expression)&&callee.expression.text==='pick')return true;
    }
    if((ts.isConditionalExpression(p)||ts.isBinaryExpression(p))&&/\blang\b|\ben\b/.test(textOf(ts.isConditionalExpression(p)?p.condition:p.left,sf)))return true;
    if(ts.isObjectLiteralExpression(p)&&p.properties.some(q=>q.name&&/^(en|\w+En)$/.test(q.name.getText(sf))))return true;
    if(ts.isArrayLiteralExpression(p)&&p.elements.some(e=>(ts.isStringLiteral(e)||ts.isNoSubstitutionTemplateLiteral(e)||ts.isTemplateExpression(e))&&!CJK.test(e.getText(sf))&&LATIN.test(e.getText(sf))))return true;
    if(ts.isPropertyAssignment(p)&&/^(zh|label|name)$/.test(p.name.getText(sf))&&ts.isObjectLiteralExpression(p.parent)&&p.parent.properties.some(q=>q.name&&/^(en|labelEn|nameEn)$/.test(q.name.getText(sf))))return true;
    if(ts.isFunctionLike(p)&&!ts.isArrowFunction(p))break;
  }
  return false;
}
const problems=[];
for(const file of page){
  const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  (function walk(node){
    const literal=ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateExpression(node)||ts.isJsxText(node);
    if(literal){
      const text=ts.isJsxText(node)?node.text.trim():node.getText(sf).slice(1,-1);
      if(CJK.test(text)&&!DATA.has(text)&&!paired(node,sf)){
        const {line}=sf.getLineAndCharacterOfPosition(node.getStart(sf));
        problems.push(`${file}:${line+1} ${text.slice(0,50)}`);
      }
      if(!ts.isTemplateExpression(node))return;
    }
    ts.forEachChild(node,walk);
  })(sf);
}
assert.deepEqual(problems,[],'Chinese text without its English:\n'+problems.join('\n'));
console.log(`PASS page text: ${page.length} files, every Chinese string has its English`);

const server=[...readdirSync('lib/server').map(f=>'lib/server/'+f),'app/api/workbench/route.ts','app/api/assets/route.ts'];
const thrown=[];
for(const file of server){
  const src=readFileSync(file,'utf8');
  for(const m of src.matchAll(/throw (?:new )?Error\(([^;]*)/g))if(CJK.test(m[1]))thrown.push(`${file}: throw Error(${m[1].slice(0,40)}`);
  // A ProviderError's options name `en` before its `category`.
  for(const m of src.matchAll(/new ProviderError\(/g)){
    const call=src.slice(m.index,m.index+900),options=call.slice(0,call.indexOf('category:'));
    if(CJK.test(options)&&!/\ben:/.test(options))thrown.push(`${file}: ProviderError without en: ${call.slice(18,60)}`);
  }
}
assert.deepEqual(thrown,[],'Server messages without English:\n'+thrown.join('\n'));
console.log(`PASS server messages: ${server.length} files, errors carry both languages`);
