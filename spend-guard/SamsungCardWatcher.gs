/** Ryan Spend Guard — 삼성카드 Gmail 감시기 골격
 * 실제 결제메일 1통 확보 후 parseSamsungCardMail()을 확정한다.
 */
const SG={NIGHT_CAP:120000,YELLOW_AT:90000,NAVER_AD:[/^네이버\(주\)$/i,/네이버파이낸셜\s*네이버/i],TAXI:[/카카오.?T/i,/택시/i,/UT/i]};
function watchSamsungCardMail(){const p=PropertiesService.getScriptProperties(),last=Number(p.getProperty('LAST_TS')||0);const ms=GmailApp.search('from:(cardweb@samsungcard.com) newer_than:2d',0,30).flatMap(t=>t.getMessages()).filter(m=>m.getDate().getTime()>last).sort((a,b)=>a.getDate()-b.getDate());let newest=last;ms.forEach(m=>{newest=Math.max(newest,m.getDate().getTime());const tx=parseSamsungCardMail(m.getPlainBody(),m.getDate());if(tx)processTx(tx)});if(newest>last)p.setProperty('LAST_TS',String(newest))}
function parseSamsungCardMail(text,date){text=String(text||'').replace(/\s+/g,' ');const a=text.match(/(?:이용금액|승인금액|금액)\s*[:：]?\s*([0-9,]+)\s*원?/i),m=text.match(/(?:가맹점|이용처|사용처)\s*[:：]?\s*([^|\n]{2,40})/i);if(!a||!m)return null;return{merchant:m[1].trim(),amount:Number(a[1].replace(/,/g,'')),date,category:classify(m[1].trim(),date)}}
function classify(name,date){if(SG.NAVER_AD.some(r=>r.test(name)))return'business';if(SG.TAXI.some(r=>r.test(name)))return'taxi';return date.getHours()>=18?'night':'personal'}
function processTx(tx){/* 실제 알림 채널은 다음 연결 단계에서 확정 */}
