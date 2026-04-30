// rh-leaderboard.jsx — Leaderboard screens (Fritz + Puzzle)
const { useState: useStateRH } = React;

const LB_FRITZ = [
  { rank:1,  handle:'Magnus_D',    result:'W', score:610, diff:+47, moves:22, time:'7:14',  isMe:false },
  { rank:2,  handle:'Cerulean99',  result:'W', score:580, diff:+31, moves:24, time:'8:02',  isMe:false },
  { rank:3,  handle:'pipcount',    result:'W', score:562, diff:+19, moves:21, time:'6:48',  isMe:false },
  { rank:4,  handle:'TileBreaker', result:'W', score:541, diff:+11, moves:27, time:'9:31',  isMe:false },
  { rank:5,  handle:'double_six',  result:'W', score:520, diff: +4, moves:26, time:'10:05', isMe:false },
  { rank:6,  handle:'@Oliver',     result:'W', score:498, diff: -2, moves:29, time:'11:22', isMe:true  },
  { rank:7,  handle:'AceOfPips',   result:'L', score:471, diff:-16, moves:28, time:'12:44', isMe:false },
];
const LB_PUZZLE = [
  { rank:1,  handle:'pipcount',    result:'S', score:100, stars:3, moves:6,  time:'0:42',  isMe:false },
  { rank:2,  handle:'Magnus_D',    result:'S', score:100, stars:3, moves:6,  time:'1:08',  isMe:false },
  { rank:3,  handle:'TileBreaker', result:'S', score:97,  stars:3, moves:7,  time:'2:14',  isMe:false },
  { rank:4,  handle:'@Oliver',     result:'S', score:88,  stars:2, moves:9,  time:'4:55',  isMe:true  },
  { rank:5,  handle:'double_six',  result:'S', score:81,  stars:2, moves:10, time:'6:22',  isMe:false },
];

function LBResultChip({ result, mode }) {
  if (mode === 'puzzle') {
    const s = result === 'S';
    return <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'2px 8px', borderRadius:999, fontFamily:"'Rajdhani',sans-serif", fontSize:'0.59rem', fontWeight:700, letterSpacing:'0.12em', background: s?'rgba(245,158,11,0.12)':'rgba(255,255,255,0.04)', border:`1px solid ${s?'rgba(245,158,11,0.36)':'rgba(255,255,255,0.09)'}`, color: s?'#f59e0b':'rgba(255,255,255,0.28)' }}>{s?'SOLVED':'PARTIAL'}</div>;
  }
  const w = result==='W';
  return <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:19, borderRadius:999, fontFamily:"'Rajdhani',sans-serif", fontSize:'0.6rem', fontWeight:700, background: w?'rgba(52,211,153,0.12)':'rgba(239,68,68,0.10)', border:`1px solid ${w?'rgba(52,211,153,0.30)':'rgba(239,68,68,0.25)'}`, color: w?'#34d399':'#ef4444' }}>{result}</div>;
}

function LBStars({ count }) {
  return <div style={{ display:'flex', gap:2 }}>{[1,2,3].map(i => <svg key={i} width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.24 2.5L10 3.8l-2 1.95.47 2.75L6 7.1l-2.47 1.4.47-2.75L2 3.8l2.76-.3L6 1z" fill={i<=count?'#f59e0b':'rgba(255,255,255,0.11)'} /></svg>)}</div>;
}

function LBRow({ row, mode, index, rowHeight }) {
  const [hov, setHov] = useStateRH(false);
  const medals = {1:'#d8b56f',2:'#a0abb8',3:'#c07a4f'};
  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{
      display:'grid',
      gridTemplateColumns: mode==='fritz' ? '44px 1fr 90px 80px 70px 60px 68px' : '44px 1fr 100px 72px 64px 60px 68px',
      alignItems:'center', height:rowHeight, padding:'0 18px', borderRadius:9, flexShrink:0,
      background: row.isMe?'rgba(149,240,202,0.05)':hov?'rgba(255,255,255,0.032)':'transparent',
      border:`1px solid ${row.isMe?'rgba(149,240,202,0.22)':hov?'rgba(255,255,255,0.10)':'rgba(255,255,255,0.055)'}`,
      position:'relative', cursor:'default',
      transition:'background 120ms ease, border-color 120ms ease',
      animation:`rowIn 260ms ease-out ${index*35}ms both`,
    }}>
      {row.rank<=3 && <div style={{ position:'absolute', left:0, top:'18%', bottom:'18%', width:2, borderRadius:2, background:medals[row.rank] }} />}
      {/* Rank */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {medals[row.rank] ? <div style={{ width:5, height:5, borderRadius:'50%', background:medals[row.rank], boxShadow:`0 0 5px ${medals[row.rank]}99` }} /> : <div style={{ width:5 }} />}
        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.93rem', fontWeight:700, color:medals[row.rank]||'rgba(255,255,255,0.30)', fontVariantNumeric:'tabular-nums', minWidth:16, textAlign:'right' }}>{row.rank}</span>
      </div>
      {/* Player */}
      <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
        <div style={{ width:25, height:25, borderRadius:'50%', flexShrink:0, background:row.isMe?'rgba(149,240,202,0.16)':`hsl(${(row.handle.charCodeAt(0)*47)%360},28%,20%)`, border:`1px solid ${row.isMe?'rgba(149,240,202,0.36)':'rgba(255,255,255,0.09)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.62rem', fontWeight:700, color:row.isMe?'#95f0ca':'rgba(255,255,255,0.5)' }}>{row.handle.replace('@','').slice(0,2).toUpperCase()}</span>
        </div>
        <span style={{ fontSize:'0.84rem', fontWeight:row.isMe?600:400, color:row.isMe?'#95f0ca':'rgba(255,255,255,0.80)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {row.handle}
          {row.isMe && <span style={{ marginLeft:6, fontFamily:"'Rajdhani',sans-serif", fontSize:'0.57rem', fontWeight:700, letterSpacing:'0.12em', color:'rgba(149,240,202,0.65)' }}>YOU</span>}
        </span>
      </div>
      <div><LBResultChip result={row.result} mode={mode} /></div>
      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'1rem', fontWeight:700, color:row.isMe?'#95f0ca':'rgba(255,255,255,0.86)', fontVariantNumeric:'tabular-nums' }}>{row.score}</div>
      {mode==='fritz' ? <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.82rem', fontWeight:600, fontVariantNumeric:'tabular-nums', color:row.diff>0?'#34d399':row.diff<0?'#ef4444':'rgba(255,255,255,0.3)' }}>{row.diff>0?`+${row.diff}`:row.diff}</div> : <LBStars count={row.stars} />}
      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.82rem', color:'rgba(255,255,255,0.38)', fontVariantNumeric:'tabular-nums' }}>{row.moves}</div>
      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.82rem', color:'rgba(255,255,255,0.38)', fontVariantNumeric:'tabular-nums' }}>{row.time}</div>
    </div>
  );
}

function LeaderboardScreen({ navigate, mode='fritz' }) {
  const accent = mode==='fritz' ? '#2dd4bf' : '#f59e0b';
  const rows   = mode==='fritz' ? LB_FRITZ : LB_PUZZLE;
  const backTo = mode==='fritz' ? 'daily-fritz-setup' : 'daily-puzzle-setup';
  const backLabel = mode==='fritz' ? 'Back to Daily Fritz' : 'Back to Daily Puzzle';
  const today = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(new Date());
  const myRow = rows.find(r=>r.isMe);
  const density='normal', rowGap=3, rowHeight=44;
  const fritzCols=['#','Player','Result','Score','Diff','Moves','Time'];
  const puzzleCols=['#','Player','Result','Score','Stars','Moves','Time'];
  const headers = mode==='fritz' ? fritzCols : puzzleCols;

  return (
    <PageShell accentColor={accent} accentOpacity={0.20}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes rowIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}`}</style>
      <NavBar navigate={navigate} variant="back" backLabel={backLabel} backTo={backTo} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:960, width:'100%', margin:'0 auto', padding:'20px clamp(16px,3vw,44px) 16px' }}>

        {/* Title */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, marginBottom:18, animation:'fadeUp 300ms ease-out both' }}>
          <div style={{ width:32, height:2.5, borderRadius:2, background:accent, marginBottom:10, boxShadow:`0 0 10px ${accent}88` }} />
          <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'clamp(1.9rem,3.2vw,2.7rem)', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'#fff', lineHeight:1, margin:'0 0 7px' }}>Leaderboard</h1>
          <p style={{ fontSize:'0.78rem', color:'rgba(255,255,255,0.36)', margin:0 }}>{today} · Global ranking</p>
        </div>

        {/* My stats cards */}
        {myRow && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, flexShrink:0, marginBottom:18 }}>
            {(mode==='fritz'
              ? [{label:'Your Rank',value:`#${myRow.rank}`,sub:'Today'},{label:'Score',value:`${myRow.score}`,sub:'vs Fritz Elite'},{label:'Rating Δ',value:`${myRow.diff>0?'+':''}${myRow.diff}`,sub:'ELO impact',neg:myRow.diff<0}]
              : [{label:'Your Rank',value:`#${myRow.rank}`,sub:'Today'},{label:'Score',value:`${myRow.score}`,sub:`${myRow.moves} moves`},{label:'Stars',value:'★★☆',sub:'Solved'}]
            ).map((s,i)=>(
              <div key={i} style={{ background:'rgba(10,16,28,0.55)', backdropFilter:'blur(18px)', border:`1px solid ${i===0?`rgba(${hexToRgb(accent)},0.42)`:'rgba(255,255,255,0.08)'}`, borderRadius:12, padding:'12px 16px', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.07)', animation:`fadeUp 280ms ease-out ${60+i*45}ms both` }}>
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(255,255,255,0.30)', marginBottom:5 }}>{s.label}</div>
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'1.6rem', fontWeight:700, color:s.neg?'#ef4444':i===0?accent:'#fff', lineHeight:1, marginBottom:3, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize:'0.71rem', color:'rgba(255,255,255,0.28)' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0, marginBottom:8 }}>
          <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }} />
          <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.57rem', fontWeight:700, letterSpacing:'0.17em', textTransform:'uppercase', color:'rgba(255,255,255,0.22)' }}>Global Results · {rows.length} {rows.length===1?'player':'players'}</span>
          <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }} />
        </div>

        {/* Headers */}
        <div style={{ display:'grid', gridTemplateColumns: mode==='fritz'?'44px 1fr 90px 80px 70px 60px 68px':'44px 1fr 100px 72px 64px 60px 68px', padding:'0 18px', marginBottom:4, flexShrink:0 }}>
          {headers.map(h=><div key={h} style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.17em', textTransform:'uppercase', color:'rgba(255,255,255,0.26)' }}>{h}</div>)}
        </div>

        {/* Rows */}
        <div style={{ display:'flex', flexDirection:'column', gap:rowGap, flex:1, minHeight:0, overflowY:rows.length>6?'auto':'visible', overflowX:'hidden', paddingRight:rows.length>6?4:0, scrollbarWidth:'thin', scrollbarColor:'rgba(255,255,255,0.12) transparent' }}>
          {rows.map((row,i)=><LBRow key={row.handle} row={row} mode={mode} index={i} rowHeight={rowHeight} />)}
        </div>

        <div style={{ textAlign:'center', flexShrink:0, paddingTop:10, fontFamily:"'Rajdhani',sans-serif", fontSize:'0.59rem', fontWeight:600, letterSpacing:'0.13em', textTransform:'uppercase', color:'rgba(255,255,255,0.18)' }}>
          Resets daily at midnight UTC
        </div>
      </div>
    </PageShell>
  );
}

function LeaderboardFritz({ navigate }) { return <LeaderboardScreen navigate={navigate} mode="fritz" />; }
function LeaderboardPuzzle({ navigate }) { return <LeaderboardScreen navigate={navigate} mode="puzzle" />; }

Object.assign(window, { LeaderboardFritz, LeaderboardPuzzle });
