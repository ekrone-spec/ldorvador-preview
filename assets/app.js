
document.getElementById('yr').textContent=new Date().getFullYear();
if('scrollRestoration' in history){history.scrollRestoration='manual';}
var header=document.getElementById('header');
function onScroll(){header.classList.toggle('scrolled', window.scrollY> window.innerHeight-90)}
onScroll(); window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('load',function(){window.scrollTo(0,0);onScroll();});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
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

/* auto-gliding carousels (\u00a73 journeys, \u00a76 offerings): float accumulator so it glides
   sub-pixel; pause on hover; user can scroll/swipe to move faster; seamless loop */
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
      if(!paused && half>0){ pos+=0.7; if(pos>=half) pos-=half; else if(pos<0) pos+=half; sc.scrollLeft=pos; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
})();

/* "Message us" popovers: toggle, close on outside-click / Escape */
document.addEventListener('click',function(e){
  var t=e.target.closest('.msgus-trigger');
  var openNow=document.querySelectorAll('.msgus.open');
  if(t){
    e.preventDefault();
    var m=t.closest('.msgus'), wasOpen=m.classList.contains('open');
    openNow.forEach(function(x){x.classList.remove('open')});
    if(!wasOpen)m.classList.add('open');
    return;
  }
  if(!e.target.closest('.msgus-pop')) openNow.forEach(function(x){x.classList.remove('open')});
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.msgus.open').forEach(function(x){x.classList.remove('open')})});

var i18n={
 en:{},
 es:{brand_sub:'Viajes de Herencia Jud\u00eda',nav_journeys:'Viajes',nav_trips:'Pr\u00f3ximas Salidas',nav_about:'Nosotros',nav_faq:'Preguntas',cta_plan:'Planifica tu Viaje',cta_enquire:'Consultar un Viaje',
   hero_h1:'De generaci\u00f3n en generaci\u00f3n,<br><em>al otro lado del mar.</em>',hero_lede:'Viajes de herencia jud\u00eda a Curazao \u2014 hogar de una de las comunidades jud\u00edas m\u00e1s antiguas y duraderas de las Am\u00e9ricas. Organizamos cada detalle, para que solo tengas que llegar.',hero_cta1:'Ver Pr\u00f3ximas Salidas',hero_cta2:'Planear un viaje privado',
   story_eyebrow:'Willemstad \u00b7 desde 1651',story_stmt:'Durante m\u00e1s de <em>375 a\u00f1os</em>, las familias jud\u00edas han comerciado, rezado y construido un hogar en esta isla. Te ayudamos a entrar en esa historia viva \u2014 no como visitante, sino como familia que regresa.',story_cta:'Descubre los viajes',pill_h2:'Cuatro formas en que la isla permanece contigo',trips_h2:'Pr\u00f3ximos viajes con plazas disponibles',reserve:'Reservar',svc_h2:'Lo que organizamos para ti',voices_h2:'Viajeros que se sintieron en casa',faq_h2:'Preguntas frecuentes',contact_h2:'Cu\u00e9ntanos qui\u00e9n viaja. Del resto nos encargamos nosotros.',f_submit:'Enviar consulta',foot_lang:'Disponible en English \u00b7 Espa\u00f1ol \u00b7 Nederlands \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'},
 nl:{brand_sub:'Joodse Erfgoedreizen',nav_journeys:'Reizen',nav_trips:'Komende Reizen',nav_about:'Over ons',nav_faq:'Vragen',cta_plan:'Plan uw Reis',cta_enquire:'Informeer naar een Reis',
   hero_h1:'Van generatie op generatie,<br><em>over de zee.</em>',hero_lede:'Joodse erfgoedreizen naar Cura\u00e7ao \u2014 thuis van een van de oudste en meest duurzame Joodse gemeenschappen van Amerika. Wij regelen elk detail, zodat u alleen hoeft aan te komen.',hero_cta1:'Bekijk Komende Reizen',hero_cta2:'Plan een priv\u00e9reis',
   story_eyebrow:'Willemstad \u00b7 sinds 1651',story_stmt:'Al meer dan <em>375 jaar</em> handelen, bidden en wonen Joodse families op dit eiland. Wij helpen u dat levende verhaal binnen te stappen \u2014 niet als bezoeker, maar als familie die terugkeert.',story_cta:'Ontdek de reizen',pill_h2:'Vier manieren waarop het eiland bij u blijft',trips_h2:'Komende reizen met nog vrije plaatsen',reserve:'Reserveren',svc_h2:'Wat wij voor u regelen',voices_h2:'Reizigers die zich thuis voelden',faq_h2:'Veelgestelde vragen',contact_h2:'Vertel ons wie er reist. Wij doen de rest.',f_submit:'Aanvraag versturen',foot_lang:'Beschikbaar in English \u00b7 Espa\u00f1ol \u00b7 Nederlands \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'},
 he:{brand_sub:'\u05de\u05d5\u05e8\u05e9\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05ea',nav_journeys:'\u05de\u05e1\u05e2\u05d5\u05ea',nav_trips:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd',nav_about:'\u05d0\u05d5\u05d3\u05d5\u05ea',nav_faq:'\u05e9\u05d0\u05dc\u05d5\u05ea',cta_plan:'\u05ea\u05db\u05e0\u05e0\u05d5 \u05d0\u05ea \u05d4\u05de\u05e1\u05e2',cta_enquire:'\u05dc\u05d1\u05e8\u05e8 \u05e2\u05dc \u05d8\u05d9\u05d5\u05dc',
   hero_h1:'\u05dc\u05d3\u05d5\u05e8 \u05d5\u05d3\u05d5\u05e8,<br><em>\u05de\u05e2\u05d1\u05e8 \u05dc\u05d9\u05dd.</em>',hero_lede:'\u05de\u05e1\u05e2\u05d5\u05ea \u05de\u05d5\u05e8\u05e9\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05ea \u05dc\u05e7\u05d5\u05e8\u05e1\u05d0\u05d5 \u2014 \u05d1\u05d9\u05ea\u05d4 \u05e9\u05dc \u05d0\u05d7\u05ea \u05d4\u05e7\u05d4\u05d9\u05dc\u05d5\u05ea \u05d4\u05d9\u05d4\u05d5\u05d3\u05d9\u05d5\u05ea \u05d4\u05e2\u05ea\u05d9\u05e7\u05d5\u05ea \u05d5\u05d4\u05de\u05ea\u05de\u05e9\u05db\u05d5\u05ea \u05d1\u05d9\u05d1\u05e9\u05ea \u05d0\u05de\u05e8\u05d9\u05e7\u05d4. \u05d0\u05e0\u05d7\u05e0\u05d5 \u05de\u05e1\u05d3\u05d9\u05e8\u05d9\u05dd \u05db\u05dc \u05e4\u05e8\u05d8, \u05db\u05d3\u05d9 \u05e9\u05ea\u05d5\u05db\u05dc\u05d5 \u05e4\u05e9\u05d5\u05d8 \u05dc\u05d4\u05d2\u05d9\u05e2.',hero_cta1:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd',hero_cta2:'\u05dc\u05ea\u05db\u05e0\u05df \u05de\u05e1\u05e2 \u05e4\u05e8\u05d8\u05d9',
   story_eyebrow:'\u05d5\u05d9\u05dc\u05de\u05e1\u05d8\u05d0\u05d3 \u00b7 \u05de\u05d0\u05d6 1651',story_stmt:'\u05d1\u05de\u05e9\u05da \u05d9\u05d5\u05ea\u05e8 \u05de\u05be<em>375 \u05e9\u05e0\u05d4</em> \u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05d9\u05d4\u05d5\u05d3\u05d9\u05d5\u05ea \u05e1\u05d7\u05e8\u05d5, \u05d4\u05ea\u05e4\u05dc\u05dc\u05d5 \u05d5\u05d1\u05e0\u05d5 \u05d1\u05d9\u05ea \u05d1\u05d0\u05d9 \u05d4\u05d6\u05d4. \u05d0\u05e0\u05d7\u05e0\u05d5 \u05e2\u05d5\u05d6\u05e8\u05d9\u05dd \u05dc\u05db\u05dd \u05dc\u05d4\u05d9\u05db\u05e0\u05e1 \u05d0\u05dc \u05d4\u05e1\u05d9\u05e4\u05d5\u05e8 \u05d4\u05d7\u05d9 \u05d4\u05d6\u05d4 \u2014 \u05dc\u05d0 \u05db\u05d0\u05d5\u05e8\u05d7\u05d9\u05dd, \u05d0\u05dc\u05d0 \u05db\u05de\u05e9\u05e4\u05d7\u05d4 \u05e9\u05e9\u05d1\u05d4 \u05d4\u05d1\u05d9\u05ea\u05d4.',story_cta:'\u05d2\u05dc\u05d5 \u05d0\u05ea \u05d4\u05de\u05e1\u05e2\u05d5\u05ea',pill_h2:'\u05d0\u05e8\u05d1\u05e2 \u05d3\u05e8\u05db\u05d9\u05dd \u05e9\u05d1\u05d4\u05df \u05d4\u05d0\u05d9 \u05e0\u05e9\u05d0\u05e8 \u05d0\u05d9\u05ea\u05db\u05dd',trips_h2:'\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05e7\u05e8\u05d5\u05d1\u05d9\u05dd \u05e2\u05dd \u05de\u05e7\u05d5\u05de\u05d5\u05ea \u05e4\u05e0\u05d5\u05d9\u05d9\u05dd',reserve:'\u05dc\u05e9\u05de\u05d5\u05e8 \u05de\u05e7\u05d5\u05dd',svc_h2:'\u05de\u05d4 \u05d0\u05e0\u05d7\u05e0\u05d5 \u05de\u05e1\u05d3\u05d9\u05e8\u05d9\u05dd \u05e2\u05d1\u05d5\u05e8\u05db\u05dd',voices_h2:'\u05de\u05d8\u05d9\u05d9\u05dc\u05d9\u05dd \u05e9\u05d4\u05e8\u05d2\u05d9\u05e9\u05d5 \u05d1\u05d1\u05d9\u05ea',faq_h2:'\u05e9\u05d0\u05dc\u05d5\u05ea \u05e0\u05e4\u05d5\u05e6\u05d5\u05ea',contact_h2:'\u05e1\u05e4\u05e8\u05d5 \u05dc\u05e0\u05d5 \u05de\u05d9 \u05de\u05d2\u05d9\u05e2. \u05d0\u05ea \u05d4\u05e9\u05d0\u05e8 \u05e0\u05e2\u05e9\u05d4 \u05d0\u05e0\u05d7\u05e0\u05d5.',f_submit:'\u05e9\u05dc\u05d7\u05d5 \u05e4\u05e0\u05d9\u05d9\u05d4',foot_lang:'\u05d6\u05de\u05d9\u05df \u05d1\u05d0\u05e0\u05d2\u05dc\u05d9\u05ea \u00b7 \u05e1\u05e4\u05e8\u05d3\u05d9\u05ea \u00b7 \u05d4\u05d5\u05dc\u05e0\u05d3\u05d9\u05ea \u00b7 \u05e2\u05d1\u05e8\u05d9\u05ea'}
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
