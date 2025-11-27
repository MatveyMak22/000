
/* App logic: parse input, detect sport, run sport-specific analysis, render beautiful output.
   Supported sports: football, hockey, table-tennis (настольный теннис).
   Input examples:
     - "Барселона - Реал"
     - "Динамо - Спартак, хоккей"
     - "Иванов - Петров, настольный теннис"
*/

function el(id){return document.getElementById(id)}
const input = el('inputMatch');
const goBtn = el('goBtn');
const resultPretty = el('resultPretty');
const presets = document.querySelectorAll('.preset');

presets.forEach(b=>b.addEventListener('click', ()=>{ input.value = b.dataset.text }));

goBtn.addEventListener('click', ()=>analyzeInput(input.value.trim()));

input.addEventListener('keyup', (e)=>{ if(e.key==='Enter') analyzeInput(input.value.trim()) });

function analyzeInput(text){
  if(!text){ resultPretty.innerHTML = '<div class="small">Введите участников...</div>'; return; }
  const parsed = parseMatchText(text);
  const sport = parsed.sport;
  const a = parsed.left;
  const b = parsed.right;

  // collect default synthetic params (could become form later)
  const params = syntheticParamsFor(a,b,sport);

  let analysis;
  if(sport==='football') analysis = analyzeFootball(params);
  else if(sport==='hockey') analysis = analyzeHockey(params);
  else if(sport==='tt') analysis = analyzeTT(params);
  else analysis = analyzeFootball(params);

  resultPretty.innerHTML = renderPretty(a,b,sport,analysis);
}

// Basic parser: split by '-' or '—' or ' vs ' and detect sport by suffix keywords
function parseMatchText(t){
  // try to extract sport after comma
  let sport = null;
  let raw = t;
  if(t.includes(',')){
    const parts = t.split(',');
    raw = parts[0].trim();
    sport = parts.slice(1).join(',').trim().toLowerCase();
    if(sport.includes('настоль') || sport.includes('тт')) sport='tt';
    else if(sport.includes('хокк')) sport='hockey';
    else if(sport.includes('фут') || sport.includes('soccer')) sport='football';
    else sport = sport; // keep raw if unknown
  }
  // split participants
  let sep = null;
  for(const s of [' - ',' — ','–',' vs ',' vs. ',' vs ','-','—']) if(raw.includes(s)){ sep = s; break; }
  let left = raw, right = '';
  if(sep){
    const parts = raw.split(sep);
    left = parts[0].trim();
    right = (parts[1]||'').trim();
  } else {
    // if single token, try to split by space before last word
    const toks = raw.split(' ');
    if(toks.length>=2){ left = toks.slice(0,-1).join(' '); right = toks.slice(-1).join(' '); }
  }
  // quick auto-detect by simple heuristics if sport not provided
  if(!sport){
    // if names look like individual players (contain personal name patterns e.g. space separated two words) and short -> table-tennis guess only when user likely provided players? choose football by default
    // we'll choose football by default unless keywords suggest otherwise
    sport = 'football';
  }
  return { left, right, sport };
}

/* -------------------------
   Synthetic parameter generator
   (creates plausible default metrics from names; user can refine later)
   ------------------------- */
function syntheticParamsFor(a,b,sport){
  // base randomness seeded by names to make deterministic-ish
  function seed(s){ let h=0; for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i))|0 } return Math.abs(h) }
  const sa = seed(a), sb = seed(b);
  const diff = (sa - sb)/1000;
  if(sport==='football'){
    return {
      team1: a, team2: b,
      form1: 3 + (sa%3), form2: 2 + (sb%3),
      goals1: 1.2 + ((sa%40)/100), goals2: 1.0 + ((sb%40)/120),
      xg1: 1.1 + ((sa%30)/100), xg2: 1.0 + ((sb%30)/120),
      elo1: 1500 + (sa%600), elo2: 1500 + (sb%600),
      home: 'yes'
    };
  }
  if(sport==='hockey'){
    return {
      team1: a, team2: b,
      shots1: 28 + (sa%8), shots2: 26 + (sb%8),
      save1: 0.905 + ((sa%20)/10000), save2: 0.902 + ((sb%20)/10000),
      pp1: 0.16 + ((sa%10)/500), pp2: 0.15 + ((sb%10)/500),
      form1: 3 + (sa%3), form2: 2 + (sb%3),
      home: 'yes'
    };
  }
  if(sport==='tt'){
    return {
      rating1: 1800 + (sa%300), rating2: 1750 + (sb%300),
      h2h1: (sa%5), h2h2: (sb%4),
      serve1: 0.62 + ((sa%20)/500), serve2: 0.60 + ((sb%20)/500),
      style1: (sa%2? 'attack':'defence'), style2: (sb%2? 'attack':'defence'),
      bestOf: 5
    };
  }
  return {};
}

/* -------------------------
   Simple models (similar to prior version but focused on presentational output)
   ------------------------- */

function softmax(arr){
  const ex = arr.map(x=>Math.exp(x));
  const s = ex.reduce((a,b)=>a+b,0);
  return ex.map(x=>x/s);
}
function poissonProb(k, lambda){
  return Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k);
}
function factorial(n){ if(n<0) return 1; if(n<=1) return 1; let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
function round(v,d=0){ return Math.round(v*Math.pow(10,d))/Math.pow(10,d); }

function analyzeFootball(p){
  const w = { form:0.18, goals:0.18, xg:0.2, elo:0.22, home:0.22 };
  const f_form = (Number(p.form1)||3) - (Number(p.form2)||3);
  const f_goals = (Number(p.goals1)||1.2) - (Number(p.goals2)||1.0);
  const f_xg = (Number(p.xg1)||1.1) - (Number(p.xg2)||1.0);
  const elo_norm = Math.tanh((Number(p.elo1)||1500 - (Number(p.elo2)||1500))/400);

  const logit_home = 0.12 + w.form*f_form + w.goals*f_goals + w.xg*f_xg + w.elo*elo_norm + w.home*(p.home==='yes'?0.1: -0.05);
  const logit_draw = -0.05 - 0.03*Math.abs(f_form);
  const logit_away = -logit_home*0.9;

  const probs = softmax([logit_home, logit_draw, logit_away]);

  const adj_home = Number(p.goals1)||1.3;
  const adj_away = Number(p.goals2)||1.1;

  let prob_total_more_25 = 0;
  for(let i=0;i<=6;i++){
    for(let j=0;j<=6;j++){
      if(i+j>2.5) prob_total_more_25 += poissonProb(i,adj_home)*poissonProb(j,adj_away);
    }
  }

  const expected_diff = adj_home - adj_away + 0.2*elo_norm + 0.15*(f_form);

  return {
    probabilities: { home: round(probs[0]*100), draw: round(probs[1]*100), away: round(probs[2]*100) },
    total: { over25: round(prob_total_more_25*100), expected_goals: [round(adj_home,2), round(adj_away,2)] },
    handicap: estimateHandicap(expected_diff)
  };
}

function analyzeHockey(p){
  const f_shots = (Number(p.shots1)||30) - (Number(p.shots2)||30);
  const f_goalie = (Number(p.save1)||0.91) - (Number(p.save2)||0.91);
  const f_form = (Number(p.form1)||3) - (Number(p.form2)||3);
  const exp_g1 = (Number(p.shots1)||30) * (1 - (Number(p.save2)||0.91)) * 0.12 + 1.3;
  const exp_g2 = (Number(p.shots2)||30) * (1 - (Number(p.save1)||0.91)) * 0.12 + 1.1;
  const score = 0.4*(f_shots/10) + 0.4*(f_goalie*10) + 0.2*(f_form/5) + (p.home==='yes'?0.08:-0.08);
  const probs = softmax([score, -0.2, -score]);

  let p_over55 = 0;
  for(let i=0;i<=8;i++){
    for(let j=0;j<=8;j++){
      if(i+j>5.5) p_over55 += poissonProb(i,exp_g1)*poissonProb(j,exp_g2);
    }
  }
  const expected_diff = exp_g1 - exp_g2 + 0.08*(f_form);

  return {
    probabilities: { home: round(probs[0]*100), away: round(probs[2]*100) },
    total: { over55: round(p_over55*100), expected_goals: [round(exp_g1,2), round(exp_g2,2)], total_expected: round(exp_g1+exp_g2,2) },
    handicap: estimateHandicap(expected_diff)
  };
}

function analyzeTT(p){
  const r1 = Number(p.rating1)||1800;
  const r2 = Number(p.rating2)||1750;
  const rdiff = (r1 - r2)/400;
  const h2h = (Number(p.h2h1)||0) - (Number(p.h2h2)||0);
  const serve_adv = (Number(p.serve1)||0.62) - (Number(p.serve2)||0.60);
  let style_factor = 0;
  if((p.style1||'attack')==='attack' && (p.style2||'defence')==='defence') style_factor = 0.08;
  if((p.style1||'defence')==='defence' && (p.style2||'attack')==='attack') style_factor = -0.06;
  const base_logit = 0.45*rdiff + 0.25*h2h + 0.2*serve_adv + style_factor;
  const p_set = 1/(1+Math.exp(-base_logit));
  const bestOf = Number(p.bestOf)||5;
  const need = Math.ceil(bestOf/2);

  // quick deterministic simulation (no random) to be fast for browser and repeatable
  // approximate probability to win match from p_set using binomial-like approach
  function matchWinProb(p_set, bestOf){
    // dynamic programming for probability of finishing with wins
    const need = Math.ceil(bestOf/2);
    const dp = Array(bestOf+1).fill(0).map(()=>Array(bestOf+1).fill(0));
    dp[0][0]=1;
    let winProb = 0;
    for(let w=0; w<=bestOf; w++){
      for(let l=0; l<=bestOf; l++){
        if(w>=need || l>=need) continue;
        const cur = dp[w][l];
        dp[w+1][l] += cur * p_set;
        dp[w][l+1] += cur * (1-p_set);
      }
    }
    let pwin=0;
    for(let w=need; w<=bestOf; w++){
      for(let l=0; l<need; l++){
        pwin += dp[w][l];
      }
    }
    return pwin;
  }
  const prob1 = matchWinProb(p_set, bestOf);
  const expected_sets = 1*p_set*bestOf; // rough
  const expected_margin = (p_set - 0.5)*bestOf;

  return {
    probabilities: { player1: round(prob1*100), player2: round((1-prob1)*100) },
    single_set_winprob: round(p_set*100,1),
    expected_sets: round(expected_sets,2),
    predicted_sets: (p_set>0.6? (need+1) : (p_set<0.4? need : need)),
    handicap: estimateHandicap(expected_margin,'sets')
  };
}

function estimateHandicap(diff, units='goals'){
  const absd = Math.abs(diff);
  if(units==='sets'){
    if(absd>1.4) return diff>0? 'Фора -2.5 по сетам (в пользу 1)': 'Фора +2.5 по сетам (в пользу 2)';
    if(absd>0.8) return diff>0? 'Фора -1.5 по сетам (в пользу 1)': 'Фора +1.5 по сетам (в пользу 2)';
    return diff>0? 'Фора(0) в пользу 1': 'Фора(0) в пользу 2';
  } else {
    if(absd>1.2) return diff>0? 'Фора -1 (в пользу 1)': 'Фора +1 (в пользу 2)';
    if(absd>0.5) return diff>0? 'Фора -0.5 (в пользу 1)': 'Фора +0.5 (в пользу 2)';
    return diff>0? 'Фора(0) в пользу 1': 'Фора(0) в пользу 2';
  }
}

/* -------------------------
   Rendering
   ------------------------- */

function renderPretty(a,b,sport,analysis){
  const leftName = escapeHtml(a||'Участник 1');
  const rightName = escapeHtml(b||'Участник 2');
  if(sport==='football'){
    return `
      <div class="headerline">
        <div class="teams">
          <div class="teamCard"><strong>${leftName}</strong><div class="small">Команда 1</div></div>
          <div style="align-self:center;color:var(--muted);margin-left:6px;margin-right:6px">—</div>
          <div class="teamCard"><strong>${rightName}</strong><div class="small">Команда 2</div></div>
        </div>
        <div class="small">Спорт: Футбол</div>
      </div>

      <div class="metrics">
        <div class="metric"><div class="small">Вероятность победы</div>
          <div class="probRow">
            <div class="probItem"><strong>${analysis.probabilities.home}%</strong><div class="small">${leftName}</div></div>
            <div class="probItem"><strong>${analysis.probabilities.draw}%</strong><div class="small">Ничья</div></div>
            <div class="probItem"><strong>${analysis.probabilities.away}%</strong><div class="small">${rightName}</div></div>
          </div>
        </div>

        <div class="metric">
          <div class="small">Тотал и ожидаемые голы</div>
          <div style="margin-top:8px"><strong>P(ТБ 2.5): ${analysis.total.over25}%</strong></div>
          <div class="small">Ожидаемые голы — ${leftName}: ${analysis.total.expected_goals[0]}, ${rightName}: ${analysis.total.expected_goals[1]}</div>
        </div>

        <div class="metric">
          <div class="small">Фора</div>
          <div style="margin-top:8px"><strong>${analysis.handicap}</strong></div>
          <div class="small">Рекомендация: ${favAdvice(analysis.probabilities)}</div>
        </div>
      </div>

      <div class="summary">
        <strong>Кратко:</strong> Модель даёт небольшое преимущество <em>${analysis.probabilities.home>analysis.probabilities.away? leftName: rightName}</em>.
        Ожидаемый счёт примерно ${analysis.total.expected_goals[0]} — ${analysis.total.expected_goals[1]}. Тотал >2.5 имеет вероятность ${analysis.total.over25}%.
      </div>
    `;
  }
  if(sport==='hockey'){
    return `
      <div class="headerline">
        <div class="teams">
          <div class="teamCard"><strong>${leftName}</strong><div class="small">Команда 1</div></div>
          <div style="align-self:center;color:var(--muted);margin-left:6px;margin-right:6px">—</div>
          <div class="teamCard"><strong>${rightName}</strong><div class="small">Команда 2</div></div>
        </div>
        <div class="small">Спорт: Хоккей</div>
      </div>

      <div class="metrics">
        <div class="metric">
          <div class="small">Вероятности (прибл.)</div>
          <div class="probRow">
            <div class="probItem"><strong>${analysis.probabilities.home}%</strong><div class="small">${leftName}</div></div>
            <div class="probItem"><strong>${analysis.probabilities.away}%</strong><div class="small">${rightName}</div></div>
          </div>
        </div>

        <div class="metric">
          <div class="small">Тотал и ожидания</div>
          <div style="margin-top:8px"><strong>P(ТБ 5.5): ${analysis.total.over55}%</strong></div>
          <div class="small">Ожидаемые голы: ${analysis.total.expected_goals[0]} — ${analysis.total.expected_goals[1]} (итого ${analysis.total.total_expected})</div>
        </div>

        <div class="metric">
          <div class="small">Фора</div>
          <div style="margin-top:8px"><strong>${analysis.handicap}</strong></div>
          <div class="small">Совет: учитывай форму вратаря и реализацию большинства.</div>
        </div>
      </div>

      <div class="summary">
        <strong>Кратко:</strong> Модель ожидает ${analysis.probabilities.home>analysis.probabilities.away? leftName: rightName} с преимуществом примерно ${Math.abs(analysis.probabilities.home-analysis.probabilities.away)} пунктов.
      </div>
    `;
  }
  if(sport==='tt'){
    return `
      <div class="headerline">
        <div class="teams">
          <div class="teamCard"><strong>${leftName}</strong><div class="small">Игрок 1</div></div>
          <div style="align-self:center;color:var(--muted);margin-left:6px;margin-right:6px">—</div>
          <div class="teamCard"><strong>${rightName}</strong><div class="small">Игрок 2</div></div>
        </div>
        <div class="small">Спорт: Настольный теннис</div>
      </div>

      <div class="metrics">
        <div class="metric">
          <div class="small">Вероятности победы в матче</div>
          <div style="margin-top:8px"><strong>${analysis.probabilities.player1}%</strong> — ${analysis.probabilities.player2}%</div>
          <div class="small">Вероятность выиграть отдельный сет: ${analysis.single_set_winprob}%</div>
        </div>

        <div class="metric">
          <div class="small">Ожидаемые сеты</div>
          <div style="margin-top:8px"><strong>~${analysis.expected_sets} сетов</strong></div>
          <div class="small">Рекомендуемая фора: ${analysis.handicap}</div>
        </div>

        <div class="metric">
          <div class="small">Совет</div>
          <div style="margin-top:8px"><strong>${analysis.probabilities.player1>analysis.probabilities.player2? leftName: rightName} — вероятный победитель</strong></div>
          <div class="small">Используй ставку на победу + фору при высокой уверенности.</div>
        </div>
      </div>
    `;
  }
  return `<div class="small">Неизвестный спорт — попробуй указать «футбол», «хоккей» или «настольный теннис»</div>`;
}

function favAdvice(probs){
  const max = Math.max(probs.home, probs.away);
  if(max>60) return 'Чёткий фаворит — можно рассмотреть одиночную ставку';
  if(max>52) return 'Незначительное преимущество — ставка с форой или коридор';
  return 'Матч сбалансирован — осторожно с ризиком';
}

function escapeHtml(s){ return s.replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] }) }
