
/* Richer logic for three sports.
   - Football: weighted features -> log-odds -> softmax probabilities; Poisson for total goals; handicap via expected diff
   - Hockey: shots, goalie form, PP/PK, compute expected goals and probabilities
   - TT: player rating + H2H + style -> best-of-5/7 sets simulation
*/

function el(id){return document.getElementById(id)}
const dynamic = el('dynamic-params');
const sportSelect = el('sport');
const analyzeBtn = el('analyzeBtn');
const exampleBtn = el('exampleBtn');
const summary = el('summary');
const resultJson = el('resultJson');

function makeInput(id, placeholder, value=''){ 
  const div = document.createElement('div');
  div.className = 'param';
  const label = document.createElement('label');
  label.textContent = placeholder;
  const input = document.createElement('input');
  input.id = id;
  input.value = value;
  div.appendChild(label);
  div.appendChild(input);
  return div;
}

function renderParams(){
  dynamic.innerHTML = '';
  const sport = sportSelect.value;
  if(sport==='football'){
    dynamic.appendChild(makeInput('form1','Форма команды 1 (0..5) — количество очков по системе W=1,D=0.5,L=0 (напр. 3=две победы и ничья)','3'));
    dynamic.appendChild(makeInput('form2','Форма команды 2 (0..5)','2'));
    dynamic.appendChild(makeInput('goals1','Средние голы за матч (команда 1)','1.6'));
    dynamic.appendChild(makeInput('goals2','Средние голы за матч (команда 2)','1.2'));
    dynamic.appendChild(makeInput('xg1','Средний xG (опционально, оставь пустым если нет)',''));
    dynamic.appendChild(makeInput('xg2','Средний xG (опционально)',''));
    dynamic.appendChild(makeInput('elo1','Elo-рейтинг команды 1 (1200..2300)','1500'));
    dynamic.appendChild(makeInput('elo2','Elo-рейтинг команды 2','1400'));
    dynamic.appendChild(makeInput('home','Домашняя игра? (yes/no)','yes'));
  }
  if(sport==='hockey'){
    dynamic.appendChild(makeInput('shots1','Средние броски за матч (команда 1)','31'));
    dynamic.appendChild(makeInput('shots2','Средние броски за матч (команда 2)','28'));
    dynamic.appendChild(makeInput('save1','Вратарь - средний сейв% (0..1)','0.913'));
    dynamic.appendChild(makeInput('save2','Вратарь - средний сейв%','0.905'));
    dynamic.appendChild(makeInput('pp1','Реализация большинства % (0..1)','0.18'));
    dynamic.appendChild(makeInput('pp2','Реализация большинства %','0.16'));
    dynamic.appendChild(makeInput('form1','Форма (0..5)','3'));
    dynamic.appendChild(makeInput('form2','Форма (0..5)','2'));
    dynamic.appendChild(makeInput('home','Домашняя игра? (yes/no)','yes'));
  }
  if(sport==='tt'){
    dynamic.appendChild(makeInput('rating1','Рейтинг игрока 1 (e.g. 2000)','1900'));
    dynamic.appendChild(makeInput('rating2','Рейтинг игрока 2','1800'));
    dynamic.appendChild(makeInput('h2h1','H2H — победы игрока 1 против игрока 2','2'));
    dynamic.appendChild(makeInput('h2h2','H2H — победы игрока 2 против игрока 1','1'));
    dynamic.appendChild(makeInput('style1','Стиль 1 (attack/defence)','attack'));
    dynamic.appendChild(makeInput('style2','Стиль 2 (attack/defence)','defence'));
    dynamic.appendChild(makeInput('serve1','Процент удачных подач 1 (0..1)','0.64'));
    dynamic.appendChild(makeInput('serve2','Процент удачных подач 2 (0..1)','0.60'));
    dynamic.appendChild(makeInput('bestOf','Формат (5 или 7) - кол-во сетов','5'));
  }
}

sportSelect.addEventListener('change', renderParams);
exampleBtn.addEventListener('click', fillExample);

function fillExample(){
  sportSelect.value='football';
  renderParams();
  el('team1').value='Zenit';
  el('team2').value='Spartak';
  el('form1').value='4';
  el('form2').value='2';
  el('goals1').value='1.9';
  el('goals2').value='1.3';
  el('elo1').value='1800';
  el('elo2').value='1650';
  el('home').value='yes';
}

function softmax(arr){
  const ex = arr.map(x=>Math.exp(x));
  const s = ex.reduce((a,b)=>a+b,0);
  return ex.map(x=>x/s);
}

function poissonProb(k, lambda){
  return Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k);
}
function factorial(n){ if(n<0) return 1; if(n<=1) return 1; let r=1; for(let i=2;i<=n;i++) r*=i; return r; }

// Football model
function analyzeFootball(p){
  // features normalization & weights
  const w = {
    form: 0.20,
    goals: 0.20,
    xg: 0.18,
    elo: 0.22,
    home: 0.20
  };
  // compute feature diffs
  const f_form = (Number(p.form1)||0) - (Number(p.form2)||0);
  const f_goals = (Number(p.goals1)||1.2) - (Number(p.goals2)||1.2);
  const f_xg = ((Number(p.xg1)||0) - (Number(p.xg2)||0)) || 0;
  const f_elo = (Number(p.elo1)||1500) - (Number(p.elo2)||1500);
  const home = (p.home && p.home.toLowerCase().startsWith('y'))?1:0;

  // map elo diff to roughly -1..1
  const elo_norm = Math.tanh(f_elo/400);

  // log-odds composition
  const logit_home = 0.15 + w.form*f_form + w.goals*f_goals + w.xg*f_xg + w.elo*elo_norm + w.home*(home?0.12:-0.12);
  const logit_draw = -0.05 + 0.1*( -Math.abs(f_form)*0.2 );
  const logit_away = - logit_home; // symmetry baseline

  const probs = softmax([logit_home, logit_draw, logit_away]);

  // totals via simplified Poisson using goals adjusted by xG and elo
  const base_home = Number(p.goals1) || 1.3;
  const base_away = Number(p.goals2) || 1.1;
  const adj_home = base_home * (1 + 0.15*Math.tanh((Number(p.xg1)||0)- (Number(p.xg2)||0)));
  const adj_away = base_away * (1 + 0.15*Math.tanh((Number(p.xg2)||0)- (Number(p.xg1)||0)));

  // compute probability totals over/under 2.5 (approx via Poisson convolution up to 6 goals)
  let prob_total_more_25 = 0;
  for(let i=0;i<=6;i++){
    for(let j=0;j<=6;j++){
      if(i+j>2.5){
        prob_total_more_25 += poissonProb(i,adj_home)*poissonProb(j,adj_away);
      }
    }
  }

  // handicap estimate: expected goal diff
  const expected_diff = adj_home - adj_away + 0.2*elo_norm + 0.25*(f_form);

  return {
    probabilities: { home: round(probs[0]*100), draw: round(probs[1]*100), away: round(probs[2]*100) },
    total: { 'O2.5_%': round(prob_total_more_25*100), 'expected_goals': [round(adj_home,2), round(adj_away,2)] },
    handicap: estimateHandicap(expected_diff)
  };
}

// Hockey model
function analyzeHockey(p){
  // features and weights
  const w = { shots:0.35, goalie:0.35, form:0.2, special:0.1 };
  const f_shots = (Number(p.shots1)||30) - (Number(p.shots2)||30);
  const f_goalie = (Number(p.save1)||0.91) - (Number(p.save2)||0.91);
  const f_form = (Number(p.form1)||3) - (Number(p.form2)||3);
  const f_pp = (Number(p.pp1)||0.16) - (Number(p.pp2)||0.16);

  // expected goals proportional to shots * (1 - opponent save)
  const exp_g1 = (Number(p.shots1)||30) * (1 - (Number(p.save2)||0.91)) * 0.12 + 1.5;
  const exp_g2 = (Number(p.shots2)||30) * (1 - (Number(p.save1)||0.91)) * 0.12 + 1.2;

  // logit approx from weighted features
  const score = w.shots*(f_shots/10) + w.goalie*(f_goalie*10) + w.form*(f_form/5) + w.special*(f_pp*10) + (p.home && p.home.toLowerCase().startsWith('y')?0.12:-0.12);
  const probs = softmax([score, -0.2, -score]);

  // total over 5.5 estimated using Poisson style (sum of expected goals)
  const total_expected = exp_g1 + exp_g2;
  // approximate P(total > 5.5) by summing Poisson convolution up to 8
  let p_over55 = 0;
  for(let i=0;i<=8;i++){
    for(let j=0;j<=8;j++){
      if(i+j>5.5){
        p_over55 += poissonProb(i,exp_g1)*poissonProb(j,exp_g2);
      }
    }
  }

  // handicap: expected margin
  const expected_diff = exp_g1 - exp_g2 + 0.1*(f_form);

  return {
    probabilities: { home: round(probs[0]*100), draw: "rare", away: round(probs[2]*100) },
    total: { 'O5.5_%': round(p_over55*100), 'expected_goals':[round(exp_g1,2), round(exp_g2,2)], 'total_expected': round(total_expected,2) },
    handicap: estimateHandicap(expected_diff)
  };
}

// Table-tennis model
function analyzeTT(p){
  // rating diff + H2H + serve + style matchup
  const r1 = Number(p.rating1)||1800;
  const r2 = Number(p.rating2)||1700;
  const rdiff = (r1 - r2)/400; // in logit units
  const h2h1 = Number(p.h2h1)||0;
  const h2h2 = Number(p.h2h2)||0;
  const serve_adv = (Number(p.serve1)||0.6) - (Number(p.serve2)||0.6);
  const style1 = (p.style1||'neutral').toLowerCase();
  const style2 = (p.style2||'neutral').toLowerCase();

  // style factor: attack > defence slightly
  let style_factor = 0;
  if(style1==='attack' && style2==='defence') style_factor = 0.08;
  if(style1==='defence' && style2==='attack') style_factor = -0.06;

  // base probability for player1 to win a single set (logistic)
  const base_logit = 0.4*rdiff + 0.25*(h2h1 - h2h2) + 0.2*serve_adv + style_factor;
  const p_set = 1/(1+Math.exp(-base_logit));

  // simulate best-of-N sets many times to estimate probabilities and expected sets
  const bestOf = Number(p.bestOf)||5;
  const need = Math.ceil(bestOf/2);
  const sims = 6000;
  let wins1=0, wins2=0, avgSets=0;
  for(let s=0;s<sims;s++){
    let w1=0,w2=0, sets=0;
    while(w1<need && w2<need){
      sets++;
      if(Math.random() < p_set) w1++; else w2++;
    }
    if(w1> w2) wins1++; else wins2++;
    avgSets += sets;
  }
  avgSets = avgSets / sims;

  // handicap in sets computed by expected margin
  const expected_margin = (p_set - 0.5) * bestOf;

  return {
    probabilities: { player1: round(wins1/sims*100), player2: round(wins2/sims*100) },
    expected_sets: round(avgSets,2),
    predicted_sets: (p_set>0.6? (need+1) : (p_set<0.4? need : need)),
    single_set_winprob: round(p_set*100),
    handicap: estimateHandicap(expected_margin, 'sets')
  };
}

function estimateHandicap(diff, units='goals'){
  // diff positive -> advantage for first participant
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

function round(v, d=0){ return Math.round(v*Math.pow(10,d))/Math.pow(10,d); }

function collectParams(){
  const sport = sportSelect.value;
  const p = { sport, team1: el('team1').value, team2: el('team2').value };
  const inputs = dynamic.querySelectorAll('input');
  inputs.forEach(inp=>p[inp.id]=inp.value);
  return p;
}

analyzeBtn.addEventListener('click', ()=>{
  const p = collectParams();
  let out = { meta: { sport: p.sport, participants: [p.team1, p.team2]} };
  if(p.sport==='football') out.analysis = analyzeFootball(p);
  if(p.sport==='hockey') out.analysis = analyzeHockey(p);
  if(p.sport==='tt') out.analysis = analyzeTT(p);
  summary.innerHTML = renderSummary(out);
  resultJson.textContent = JSON.stringify(out,null,2);
});

function renderSummary(out){
  const s = out.meta.sport;
  if(s==='football'){
    const probs = out.analysis.probabilities;
    return `
<b>Вероятности:</b>
Команда 1: ${probs.home}%  — Ничья: ${probs.draw}%  — Команда 2: ${probs.away}%

<b>Тотал:</b> Вероятность больше 2.5 голов: ${out.analysis.total['O2.5_%']}% 
Ожидаемые голы: ${out.analysis.total.expected_goals[0]} — ${out.analysis.total.expected_goals[1]}

<b>Фора:</b> ${out.analysis.handicap}
`.trim();
  }
  if(s==='hockey'){
    const probs = out.analysis.probabilities;
    return `
<b>Вероятности:</b>
Команда 1: ${probs.home}%  — Команда 2: ${probs.away}%

<b>Тотал:</b> Вероятность больше 5.5 голов: ${out.analysis.total['O5.5_%']}% 
Ожидаемые голы: ${out.analysis.total.expected_goals[0]} — ${out.analysis.total.expected_goals[1]} (итого ${out.analysis.total.total_expected})

<b>Фора:</b> ${out.analysis.handicap}
`.trim();
  }
  if(s==='tt'){
    const probs = out.analysis.probabilities;
    return `
<b>Вероятности:</b>
Игрок 1: ${probs.player1}%  —  Игрок 2: ${probs.player2}%

<b>Вероятность выиграть отдельный сет:</b> ${out.analysis.single_set_winprob}% 
<b>Ожидаемые сеты:</b> ~${out.analysis.expected_sets} 
<b>Рекомендуемая фора:</b> ${out.analysis.handicap}
`.trim();
  }
  return '';
}

// initial render
renderParams();
