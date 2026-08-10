
document.getElementById('yr').textContent=new Date().getFullYear();
if('scrollRestoration' in history){history.scrollRestoration='manual';}
var header=document.getElementById('header');
function onScroll(){header.classList.toggle('scrolled', window.scrollY> window.innerHeight-90);header.classList.toggle('logo-min', window.scrollY>18)}
onScroll(); window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('load',function(){window.scrollTo(0,0);onScroll();});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.08});
document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});
/* map: hold 5s after it's in view, then begin the very slow zoom (only if a map exists) */
var mapwrap=document.getElementById('mapwrap');
if(mapwrap){
  var mapFired=false;
  var mio=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting && !mapFired){mapFired=true;setTimeout(function(){document.getElementById('map').classList.add('map-in')},5000);}
  })},{threshold:.5});
  mio.observe(mapwrap);
}

/* curtain footer: the page lifts to reveal the fixed footer beneath it */
(function(){
  var f=document.querySelector('footer'), below=document.querySelector('.below');
  if(!f||!below) return;
  function layout(){
    var h=f.offsetHeight;
    below.style.marginBottom=h+'px';
    // keep it hidden over the hero; once the page has lifted past the footer's
    // own height it is covered by .below, and only the end-scroll gap reveals it
    f.style.visibility = (window.scrollY > h*0.9) ? 'visible' : 'hidden';
  }
  layout();
  window.addEventListener('scroll',layout,{passive:true});
  window.addEventListener('resize',layout);
  window.addEventListener('load',layout);
})();




/* Section headers land large and settle into place as the section arrives. */
(function(){
  var heads=[].slice.call(document.querySelectorAll('.sec-head'));
  if(!heads.length) return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  var MAX=0.85;            // extra scale at the moment the section appears
  var rtl=getComputedStyle(document.documentElement).direction==='rtl';
  var ticking=false;
  function frame(){
    ticking=false;
    var vh=window.innerHeight;
    for(var i=0;i<heads.length;i++){
      var h=heads[i];
      var sec=h.closest('section')||h.parentNode;
      var top=sec.getBoundingClientRect().top;
      // p: 0 when the section top sits at the viewport bottom, 1 once it reaches the top
      var p=(vh-top)/vh;
      p=p<0?0:(p>1?1:p);
      var e=1-Math.pow(1-p,3);           // ease out
      // Never let the scaled header run past its container. transform-origin
      // pins one edge, so measure the room on the side it actually grows toward.
      var own=h.offsetWidth||1;
      var par=h.parentElement, cap=1+MAX;
      if(par){
        var pr=par.getBoundingClientRect(), pcs=getComputedStyle(par);
        var cl=pr.left+(parseFloat(pcs.paddingLeft)||0);
        var cr=pr.right-(parseFloat(pcs.paddingRight)||0);
        var hb=h.getBoundingClientRect();
        var room=rtl?(hb.right-cl):(cr-hb.left);
        if(room>0) cap=Math.max(1,room/own);
      }
      var top_=Math.min(1+MAX,cap);
      h.style.setProperty('--hs',(1+(1-e)*(top_-1)).toFixed(4));
    }
  }
  function onScrollHead(){ if(!ticking){ticking=true;requestAnimationFrame(frame);} }
  frame();
  window.addEventListener('scroll',onScrollHead,{passive:true});
  window.addEventListener('resize',onScrollHead);
  window.addEventListener('load',frame);
})();

/* Discover Curacao: auto-gliding gallery. Float accumulator so it glides
   sub-pixel; pauses on hover; scroll or swipe to move faster; seamless loop. */
(function(){
  var reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  document.querySelectorAll('.jscroll').forEach(function(sc){
    var half=0; function measure(){half=sc.scrollWidth/2;}
    measure(); window.addEventListener('load',measure); window.addEventListener('resize',measure);
    if(reduce) return;
    var pos=0, paused=false;
    sc.addEventListener('mouseenter',function(){paused=true;});
    sc.addEventListener('mouseleave',function(){paused=false;});
    sc.addEventListener('scroll',function(){ if(Math.abs(sc.scrollLeft-pos)>2) pos=sc.scrollLeft; });
    function tick(){
      if(half<=0) measure();
      if(!paused && half>0){ pos+=0.55; if(pos>=half) pos-=half; else if(pos<0) pos+=half; sc.scrollLeft=pos; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
})();

/* Anchor jumps. Sections are stacked sticky: a pinned section reports a client
   rect top of 0, so the browser's own anchor maths can land in the wrong place.
   Element heights are unaffected by sticky, so we derive the flow position by
   summing the heights of the preceding siblings. */
(function(){
  function flowTopOf(node){
    var below=document.querySelector('.below');
    if(!below) return null;
    var sec=node;
    while(sec && sec.parentElement!==below) sec=sec.parentElement;
    if(!sec) return null;                       // not inside .below
    var y=below.getBoundingClientRect().top+window.pageYOffset;
    var kids=below.children;
    for(var i=0;i<kids.length;i++){
      if(kids[i]===sec) break;
      y+=kids[i].getBoundingClientRect().height;
    }
    return Math.round(y);
  }
  document.addEventListener('click',function(e){
    var a=e.target.closest && e.target.closest('a[href*="#"]');
    if(!a) return;
    var href=a.getAttribute('href')||'';
    var i=href.indexOf('#');
    var path=href.slice(0,i), hash=href.slice(i);
    if(hash.length<2) return;
    if(path && path.indexOf('index.html')===-1) return;   // link to another page
    var t=document.querySelector(hash);
    if(!t) return;
    var y=flowTopOf(t);
    if(y===null) return;                        // let the browser handle it
    e.preventDefault();
    y=Math.max(0,y-(parseFloat(getComputedStyle(t).scrollMarginTop)||0));
    var reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    window.scrollTo({top:y,behavior:reduce?'auto':'smooth'});
    if(history.replaceState) history.replaceState(null,'',hash);
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
})();

/* Hero video rotation. The still image carries the hero by default; the clips
   only load on a wide screen, with motion allowed and no data-saver set.

   Crossfade notes: only the incoming clip animates, stacked above the outgoing
   one, so the two never sit at part opacity together and reveal the background
   through the gap. The fade does not start until the incoming frame is actually
   decodable, and each clip is rewound so it always enters on its first frame. */
(function(){
  var box=document.querySelector('.hero-videos');
  if(!box) return;
  var vids=[].slice.call(box.querySelectorAll('.hero-video'));
  if(!vids.length) return;
  // Each clip is 9.6s. It is shown for HOLD then covered over FADE, so it is
  // hidden by 9.2s and never reaches its end while on screen. That end-of-clip
  // jump was the snap. `loop` is off for the same reason.
  var HOLD=7000, FADE=2200, CLIP=9600, i=0, timer=null, started=false;

  function eligible(){
    if(window.matchMedia('(prefers-reduced-motion:reduce)').matches) return false;
    var w=window.innerWidth||document.documentElement.clientWidth||0;
    if(w<820) return false;
    var c=navigator.connection||{};
    if(c.saveData || /(^|-)2g$/.test(c.effectiveType||'')) return false;
    return true;
  }
  function load(v){
    if(v.dataset.loaded) return;
    v.dataset.loaded='1'; v.preload='auto';
    v.src=v.getAttribute('data-src'); v.load();
  }
  function abort(){
    if(timer) clearInterval(timer);
    vids.forEach(function(o){ o.classList.remove('on'); o.removeAttribute('src'); });
  }
  function reveal(n){
    var v=vids[n];
    try{ v.currentTime=0; }catch(e){}      // always enter on the first frame
    var p=v.play();
    if(p&&p.catch) p.catch(function(){ if(n===0) abort(); });
    vids.forEach(function(o,k){ o.style.zIndex = (k===n) ? 2 : 1; });
    v.classList.add('on');                  // only the incoming animates
    setTimeout(function(){                  // retire the others once it is covered
      vids.forEach(function(o,k){
        if(k!==n){ o.classList.remove('on'); o.pause(); }
      });
    }, FADE);
    load(vids[(n+1)%vids.length]);          // fetch the next one ahead of its turn
  }
  function show(n){
    var v=vids[n];
    load(v);
    if(v.readyState>=2) reveal(n);
    else v.addEventListener('canplay', function(){ reveal(n); }, {once:true});
  }
  function start(){
    if(started||!eligible()) return;
    started=true;
    show(0);
    timer=setInterval(function(){ i=(i+1)%vids.length; show(i); }, HOLD);
  }
  if(document.readyState==='complete') start();
  else window.addEventListener('load', start, {once:true});
  window.addEventListener('resize', start);
})();

/* Enlarge a Discover photo. The carousel keeps gliding underneath, so the
   overlay pauses nothing; it just sits on top until dismissed. */
(function(){
  var lb=document.getElementById('lightbox');
  if(!lb) return;
  var img=lb.querySelector('img'), cap=lb.querySelector('figcaption');
  var closeBtn=lb.querySelector('.lb-close'), lastFocus=null;
  function open(card){
    var full=card.getAttribute('data-full'); if(!full) return;
    var t=card.querySelector('.teaser .jt'), s=card.querySelector('.teaser .jd');
    lastFocus=card;
    img.src=full;
    img.alt=t?t.textContent:'';
    cap.textContent=[t&&t.textContent, s&&s.textContent].filter(Boolean).join(' \u00b7 ');
    lb.hidden=false;
    requestAnimationFrame(function(){ lb.classList.add('open'); });
    closeBtn.focus();
    document.body.style.overflow='hidden';
  }
  function close(){
    lb.classList.remove('open');
    document.body.style.overflow='';
    setTimeout(function(){ lb.hidden=true; img.removeAttribute('src'); }, 350);
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('.lb-close')){ close(); return; }
    if(!lb.hidden && e.target===lb){ close(); return; }
    var card=e.target.closest && e.target.closest('.jcard[data-full]');
    if(card && !e.target.closest('a')){ e.preventDefault(); open(card); }
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape' && !lb.hidden){ close(); return; }
    var card=document.activeElement && document.activeElement.closest
             && document.activeElement.closest('.jcard[data-full]');
    if(card && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); open(card); }
  });
})();

var i18n={
 en:{},
 es:{brand_sub:'Viajes de Herencia Jud\u00eda',nav_journeys:'Viajes',nav_trips:'Pr\u00f3ximas Salidas',nav_about:'Nosotros',nav_faq:'Preguntas',cta_plan:'Planifica tu Viaje',cta_enquire:'Consultar un Viaje',
   hero_h1:'De generaci\u00f3n en generaci\u00f3n,<br><em>al otro lado del mar.</em>',hero_lede:'Viajes de herencia jud\u00eda a Curazao, hogar de una de las comunidades jud\u00edas m\u00e1s antiguas y duraderas de las Am\u00e9ricas. Organizamos cada detalle, para que solo tengas que llegar.',hero_cta1:'Ver Pr\u00f3ximas Salidas',hero_cta2:'Planear un viaje privado',
   story_eyebrow:'Willemstad \u00b7 desde 1651',story_stmt:'Durante m\u00e1s de <em>375 a\u00f1os</em>, las familias jud\u00edas han comerciado, rezado y construido un hogar en esta isla. Te ayudamos a entrar en esa historia viva, no como visitante, sino como familia que regresa.',story_cta:'Descubre los viajes',pill_h2:'Cuatro formas en que la isla permanece contigo',trips_h2:'Pr\u00f3ximos viajes con plazas disponibles',reserve:'Reservar',svc_h2:'Lo que organizamos para ti',voices_h2:'Viajeros que se sintieron en casa',faq_h2:'Preguntas frecuentes',contact_h2:'Cu\u00e9ntanos qui\u00e9n viaja. Del resto nos encargamos nosotros.',f_submit:'Enviar consulta',foot_lang:'Disponible en English \u00b7 Espa\u00f1ol \u00b7 Nederlands \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'},
 nl:{brand_sub:'Joodse Erfgoedreizen',nav_journeys:'Reizen',nav_trips:'Komende Reizen',nav_about:'Over ons',nav_faq:'Vragen',cta_plan:'Plan uw Reis',cta_enquire:'Informeer naar een Reis',
   hero_h1:'Van generatie op generatie,<br><em>over de zee.</em>',hero_lede:'Joodse erfgoedreizen naar Cura\u00e7ao, thuis van een van de oudste en meest duurzame Joodse gemeenschappen van Amerika. Wij regelen elk detail, zodat u alleen hoeft aan te komen.',hero_cta1:'Bekijk Komende Reizen',hero_cta2:'Plan een priv\u00e9reis',
   story_eyebrow:'Willemstad \u00b7 sinds 1651',story_stmt:'Al meer dan <em>375 jaar</em> handelen, bidden en wonen Joodse families op dit eiland. Wij helpen u dat levende verhaal binnen te stappen, niet als bezoeker, maar als familie die terugkeert.',story_cta:'Ontdek de reizen',pill_h2:'Vier manieren waarop het eiland bij u blijft',trips_h2:'Komende reizen met nog vrije plaatsen',reserve:'Reserveren',svc_h2:'Wat wij voor u regelen',voices_h2:'Reizigers die zich thuis voelden',faq_h2:'Veelgestelde vragen',contact_h2:'Vertel ons wie er reist. Wij doen de rest.',f_submit:'Aanvraag versturen',foot_lang:'Beschikbaar in English \u00b7 Espa\u00f1ol \u00b7 Nederlands \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'},
 he:{brand_sub:'\u05de\u05d5\u05e8\u05e9\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05ea',nav_journeys:'\u05de\u05e1\u05e2\u05d5\u05ea',nav_trips:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd',nav_about:'\u05d0\u05d5\u05d3\u05d5\u05ea',nav_faq:'\u05e9\u05d0\u05dc\u05d5\u05ea',cta_plan:'\u05ea\u05db\u05e0\u05e0\u05d5 \u05d0\u05ea \u05d4\u05de\u05e1\u05e2',cta_enquire:'\u05dc\u05d1\u05e8\u05e8 \u05e2\u05dc \u05d8\u05d9\u05d5\u05dc',
   hero_h1:'\u05dc\u05d3\u05d5\u05e8 \u05d5\u05d3\u05d5\u05e8,<br><em>\u05de\u05e2\u05d1\u05e8 \u05dc\u05d9\u05dd.</em>',hero_lede:'\u05de\u05e1\u05e2\u05d5\u05ea \u05de\u05d5\u05e8\u05e9\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05ea \u05dc\u05e7\u05d5\u05e8\u05e1\u05d0\u05d5, \u05d1\u05d9\u05ea\u05d4 \u05e9\u05dc \u05d0\u05d7\u05ea \u05d4\u05e7\u05d4\u05d9\u05dc\u05d5\u05ea \u05d4\u05d9\u05d4\u05d5\u05d3\u05d9\u05d5\u05ea \u05d4\u05e2\u05ea\u05d9\u05e7\u05d5\u05ea \u05d5\u05d4\u05de\u05ea\u05de\u05e9\u05db\u05d5\u05ea \u05d1\u05d9\u05d1\u05e9\u05ea \u05d0\u05de\u05e8\u05d9\u05e7\u05d4. \u05d0\u05e0\u05d7\u05e0\u05d5 \u05de\u05e1\u05d3\u05d9\u05e8\u05d9\u05dd \u05db\u05dc \u05e4\u05e8\u05d8, \u05db\u05d3\u05d9 \u05e9\u05ea\u05d5\u05db\u05dc\u05d5 \u05e4\u05e9\u05d5\u05d8 \u05dc\u05d4\u05d2\u05d9\u05e2.',hero_cta1:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd',hero_cta2:'\u05dc\u05ea\u05db\u05e0\u05df \u05de\u05e1\u05e2 \u05e4\u05e8\u05d8\u05d9',
   story_eyebrow:'\u05d5\u05d9\u05dc\u05de\u05e1\u05d8\u05d0\u05d3 \u00b7 \u05de\u05d0\u05d6 1651',story_stmt:'\u05d1\u05de\u05e9\u05da \u05d9\u05d5\u05ea\u05e8 \u05de\u05be<em>375 \u05e9\u05e0\u05d4</em> \u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05d5\u05ea \u05e1\u05d7\u05e8\u05d5, \u05d4\u05ea\u05e4\u05dc\u05dc\u05d5 \u05d5\u05d1\u05e0\u05d5 \u05d1\u05d9\u05ea \u05d1\u05d0\u05d9 \u05d4\u05d6\u05d4. \u05d0\u05e0\u05d7\u05e0\u05d5 \u05e2\u05d5\u05d6\u05e8\u05d9\u05dd \u05dc\u05db\u05dd \u05dc\u05d4\u05d9\u05db\u05e0\u05e1 \u05d0\u05dc \u05d4\u05e1\u05d9\u05e4\u05d5\u05e8 \u05d4\u05d7\u05d9 \u05d4\u05d6\u05d4, \u05dc\u05d0 \u05db\u05d0\u05d5\u05e8\u05d7\u05d9\u05dd, \u05d0\u05dc\u05d0 \u05db\u05de\u05e9\u05e4\u05d7\u05d4 \u05e9\u05e9\u05d1\u05d4 \u05d4\u05d1\u05d9\u05ea\u05d4.',story_cta:'\u05d2\u05dc\u05d5 \u05d0\u05ea \u05d4\u05de\u05e1\u05e2\u05d5\u05ea',pill_h2:'\u05d0\u05e8\u05d1\u05e2 \u05d3\u05e8\u05db\u05d9\u05dd \u05e9\u05d1\u05d4\u05df \u05d4\u05d0\u05d9 \u05e0\u05e9\u05d0\u05e8 \u05d0\u05d9\u05ea\u05db\u05dd',trips_h2:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd \u05e2\u05dd \u05de\u05e7\u05d5\u05de\u05d5\u05ea \u05e4\u05e0\u05d5\u05d9\u05d9\u05dd',reserve:'\u05dc\u05e9\u05de\u05d5\u05e8 \u05de\u05e7\u05d5\u05dd',svc_h2:'\u05de\u05d4 \u05d0\u05e0\u05d7\u05e0\u05d5 \u05de\u05e1\u05d3\u05d9\u05e8\u05d9\u05dd \u05e2\u05d1\u05d5\u05e8\u05db\u05dd',voices_h2:'\u05de\u05d8\u05d9\u05d9\u05dc\u05d9\u05dd \u05e9\u05d4\u05e8\u05d2\u05d9\u05e9\u05d5 \u05d1\u05d1\u05d9\u05ea',faq_h2:'\u05e9\u05d0\u05dc\u05d5\u05ea \u05e0\u05e4\u05d5\u05e6\u05d5\u05ea',contact_h2:'\u05e1\u05e4\u05e8\u05d5 \u05dc\u05e0\u05d5 \u05de\u05d9 \u05de\u05d2\u05d9\u05e2. \u05d0\u05ea \u05d4\u05e9\u05d0\u05e8 \u05e0\u05e2\u05e9\u05d4 \u05d0\u05e0\u05d7\u05e0\u05d5.',f_submit:'\u05e9\u05dc\u05d7\u05d5 \u05e4\u05e0\u05d9\u05d9\u05d4',foot_lang:'\u05d6\u05de\u05d9\u05df \u05d1\u05d0\u05e0\u05d2\u05dc\u05d9\u05ea \u00b7 \u05e1\u05e4\u05e8\u05d3\u05d9\u05ea \u00b7 \u05d4\u05d5\u05dc\u05e0\u05d3\u05d9\u05ea \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'}
};
var enStore={};
document.querySelectorAll('[data-i18n]').forEach(function(el){enStore[el.getAttribute('data-i18n')]=el.innerHTML});
function setLang(l){
 var d=i18n[l]||{};
 document.querySelectorAll('[data-i18n]').forEach(function(el){var k=el.getAttribute('data-i18n');el.innerHTML=(l==='en')?enStore[k]:(d[k]!==undefined?d[k]:enStore[k])});
 document.documentElement.setAttribute('lang',l);document.documentElement.setAttribute('dir',l==='he'?'rtl':'ltr');
 document.querySelectorAll('.lang button').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-lang')===l)});
}
document.querySelectorAll('.lang button').forEach(function(b){b.addEventListener('click',function(){setLang(b.getAttribute('data-lang'))})});
