import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 10000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(",").map(x=>x.trim()) : true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const TD_KEY = process.env.TWELVE_DATA_API_KEY;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FRED_KEY = process.env.FRED_API_KEY;
const TD_BASE = "https://api.twelvedata.com";

const SYMBOLS = {
  XAUUSD: process.env.TD_XAUUSD_SYMBOL || "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  JPN225: process.env.TD_JPN225_SYMBOL || "N225",
  AUDUSD: "AUD/USD"
};

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function td(pathname, params={}) {
  if (!TD_KEY) throw new Error("TWELVE_DATA_API_KEY is missing");
  const u = new URL(TD_BASE + pathname);
  Object.entries({...params, apikey: TD_KEY}).forEach(([k,v])=>u.searchParams.set(k,v));
  const r = await fetch(u, {headers:{Accept:"application/json"}});
  const j = await r.json();
  if (!r.ok || j.status === "error" || j.code) throw new Error(j.message || `Twelve Data ${r.status}`);
  return j;
}

function closes(rows){ return rows.map(x=>Number(x.close)).filter(Number.isFinite).reverse(); }
function ema(values, period){
  if(values.length < period) return null;
  const k=2/(period+1);
  let e=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<values.length;i++) e=values[i]*k+e*(1-k);
  return e;
}
function rsi(values, period=14){
  if(values.length<period+1)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
  let ag=gain/period, al=loss/period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period}
  if(al===0)return 100; return 100-(100/(1+ag/al));
}
function adx(rows, period=14){
  if(rows.length<period*2+2)return null;
  const h=rows.map(x=>Number(x.high)).reverse(),l=rows.map(x=>Number(x.low)).reverse(),c=rows.map(x=>Number(x.close)).reverse();
  let tr=[],pdm=[],mdm=[];
  for(let i=1;i<h.length;i++){const up=h[i]-h[i-1],down=l[i-1]-l[i];tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));pdm.push(up>down&&up>0?up:0);mdm.push(down>up&&down>0?down:0)}
  if(tr.length<period*2)return null;
  let atr=tr.slice(0,period).reduce((a,b)=>a+b,0)/period, p= pdm.slice(0,period).reduce((a,b)=>a+b,0)/period, m=mdm.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const dx=[];
  for(let i=period;i<tr.length;i++){atr=(atr*(period-1)+tr[i])/period;p=(p*(period-1)+pdm[i])/period;m=(m*(period-1)+mdm[i])/period;const dip=100*p/atr,dim=100*m/atr;dx.push(100*Math.abs(dip-dim)/Math.max(dip+dim,1e-9))}
  if(dx.length<period)return null;
  return dx.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function atr(rows,period=14){
  const h=rows.map(x=>Number(x.high)).reverse(),l=rows.map(x=>Number(x.low)).reverse(),c=rows.map(x=>Number(x.close)).reverse();
  const tr=[];for(let i=1;i<h.length;i++)tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
  return tr.length<period?null:tr.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function makeSignal(symbol, rows){
  const values=closes(rows), price=values.at(-1);
  const e50=ema(values,50),e200=ema(values,200),rv=rsi(values),ax=adx(rows),a=atr(rows);
  let score=0,reasons=[];
  if(e50&&e200){if(price>e50&&e50>e200){score+=2;reasons.push("price above EMA50 and EMA50 above EMA200")} if(price<e50&&e50<e200){score-=2;reasons.push("price below EMA50 and EMA50 below EMA200")}}
  if(rv!==null){if(rv>52&&rv<70){score+=1;reasons.push("RSI supports bullish momentum")}else if(rv<48&&rv>30){score-=1;reasons.push("RSI supports bearish momentum")}}
  if(ax!==null&&ax>=20){if(score>0){score+=1;reasons.push(`ADX ${ax.toFixed(1)} confirms trend strength`)}else if(score<0){score-=1;reasons.push(`ADX ${ax.toFixed(1)} confirms trend strength`)}}
  const direction=score>=3?"BUY":score<=-3?"SELL":"WAIT";
  const stopDistance=a?1.5*a:null;
  const entry=price;
  const stopLoss=direction==="BUY"&&stopDistance?price-stopDistance:direction==="SELL"&&stopDistance?price+stopDistance:null;
  const tp1=direction==="BUY"&&stopDistance?price+stopDistance:direction==="SELL"&&stopDistance?price-stopDistance:null;
  const tp2=direction==="BUY"&&stopDistance?price+2*stopDistance:direction==="SELL"&&stopDistance?price-2*stopDistance:null;
  return {price,entry,stopLoss,tp1,tp2,direction,indicators:{rsi:rv,adx:ax,ema50:e50,ema200:e200},reason:reasons.length?reasons.join(". ")+".":"No confluence threshold reached; engine is waiting.",timestamp:new Date().toISOString()};
}

async function signalFor(key){
  const data=await td("/time_series",{symbol:SYMBOLS[key],interval:process.env.MARKET_INTERVAL||"15min",outputsize:260,timezone:"UTC"});
  if(!data.values?.length) throw new Error(`${key}: no time-series values`);
  const sig=makeSignal(key,data.values);
  const values=closes(data.values);
  const prev=values.length>1?values.at(-2):null;
  sig.percentChange=prev?((sig.price-prev)/prev)*100:0;
  sig.sourceSymbol=SYMBOLS[key];
  return sig;
}

app.get("/api/health",(req,res)=>res.json({ok:true,time:new Date().toISOString(),marketProvider:TD_KEY?"twelve-data":"missing",economicProvider:FINNHUB_KEY?"finnhub":FRED_KEY?"fred":"missing"}));

app.get("/api/signals",async(req,res)=>{
  if(!TD_KEY)return res.status(503).json({error:"TWELVE_DATA_API_KEY is not configured"});
  const out={};
  const entries=Object.keys(SYMBOLS);
  const results=await Promise.allSettled(entries.map(k=>signalFor(k)));
  results.forEach((r,i)=>{if(r.status==="fulfilled")out[entries[i]]=r.value;else out[entries[i]]={direction:"WAIT",reason:r.reason?.message||"Market data unavailable"}})
  res.json(out);
});

async function finnhubCalendar(){
  const now=new Date(), end=new Date(now.getTime()+14*86400000);
  const q=new URL("https://finnhub.io/api/v1/calendar/economic");
  q.searchParams.set("from",now.toISOString().slice(0,10));q.searchParams.set("to",end.toISOString().slice(0,10));q.searchParams.set("token",FINNHUB_KEY);
  const r=await fetch(q);const j=await r.json();return (j.economicCalendar||[]).filter(e=>String(e.country||"").toUpperCase()==="US").map(e=>({name:e.event,country:e.country,impact:e.impact||"HIGH",date:e.time,actual:e.actual,forecast:e.estimate,previous:e.prev,type:String(e.event||"").toUpperCase().includes("FOMC")?"FOMC":undefined,unit:e.unit}));
}
async function fredFallback(){
  if(!FRED_KEY)return [];
  const releases=[10,53,50,21,22,101]; // CPI, GDP, PCE, etc.; dates are sourced from FRED.
  const today=new Date().toISOString().slice(0,10), end=new Date(Date.now()+45*86400000).toISOString().slice(0,10);
  const all=[];
  for(const id of releases){
    try{
      const u=new URL("https://api.stlouisfed.org/fred/release/dates");u.searchParams.set("release_id",id);u.searchParams.set("api_key",FRED_KEY);u.searchParams.set("file_type","json");u.searchParams.set("realtime_start",today);u.searchParams.set("realtime_end",end);u.searchParams.set("include_release_dates_with_no_data","true");
      const j=await (await fetch(u)).json();
      for(const x of (j.release_dates||[]))all.push({name:id===10?"CPI":id===53?"GDP":id===50?"PCE":"US Economic Release",country:"US",impact:"HIGH",date:x.date+"T13:30:00Z",actual:null,forecast:null,previous:null});
    }catch{}
  }
  return all;
}
app.get("/api/economic-events",async(req,res)=>{
  try{
    const events=FINNHUB_KEY?await finnhubCalendar():await fredFallback();
    res.json(events.sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,100));
  }catch(e){res.status(502).json({error:e.message})}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Quant-Alpha server listening on ${PORT}`));
