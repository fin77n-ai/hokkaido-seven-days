// 每日路线图底图：打开某天的路线图时，从 OpenFreeMap 取 OpenStreetMap 矢量瓦片，画出道路、铁路、河流、水面和公园轮廓。
// 瓦片由 sw.js 存进 MAP_CACHE，看过一次以后离线也能显示；取不到就只显示路线和站点。
(function(){
  var TJ='https://tiles.openfreemap.org/planet', Z=14;
  function tplUrl(){
    var saved=store.get('hokkaido-tile-tpl');
    if(saved) return Promise.resolve(saved);
    return fetch(TJ).then(function(r){return r.json();}).then(function(j){ store.set('hokkaido-tile-tpl',j.tiles[0]); return j.tiles[0]; });
  }
  // ---- minimal Mapbox Vector Tile decoder (protobuf varints, packed geometry) ----
  function Reader(buf){ this.b=new Uint8Array(buf); this.p=0; }
  Reader.prototype.v=function(){ var b=this.b,r=0,s=1,c; do{ c=b[this.p++]; r+=(c&127)*s; s*=128; }while(c>=128); return r; };
  Reader.prototype.skip=function(t){ if(t===0) this.v(); else if(t===2) this.p+=this.v(); else if(t===5) this.p+=4; else if(t===1) this.p+=8; };
  Reader.prototype.str=function(n){ var s=this.b.subarray(this.p,this.p+n); this.p+=n; return new TextDecoder().decode(s); };
  function packed(r){ var n=r.v(),end=r.p+n,o=[]; while(r.p<end) o.push(r.v()); return o; }
  function value(r,end){ var v=null; while(r.p<end){ var k=r.v(),f=k>>3,t=k&7; if(f===1) v=r.str(r.v()); else if(f===7) v=!!r.v(); else r.skip(t); } return v; }
  function layers(buf){
    var r=new Reader(buf),out={};
    while(r.p<r.b.length){
      var k=r.v(); if((k>>3)!==3){ r.skip(k&7); continue; }
      var end=r.v()+r.p,L={name:'',keys:[],vals:[],feats:[],ext:4096};
      while(r.p<end){
        var k2=r.v(),f=k2>>3,t=k2&7;
        if(f===1) L.name=r.str(r.v());
        else if(f===2){ var fe=r.v()+r.p,F={tags:[],type:0,geom:[]}; while(r.p<fe){ var k3=r.v(),g=k3>>3; if(g===2) F.tags=packed(r); else if(g===3) F.type=r.v(); else if(g===4) F.geom=packed(r); else r.skip(k3&7); } L.feats.push(F); }
        else if(f===3) L.keys.push(r.str(r.v()));
        else if(f===4){ var ve=r.v()+r.p; L.vals.push(value(r,ve)); r.p=ve; }
        else if(f===5) L.ext=r.v();
        else r.skip(t);
      }
      out[L.name]=L;
    }
    return out;
  }
  function props(L,F){ var o={}; for(var i=0;i<F.tags.length;i+=2) o[L.keys[F.tags[i]]]=L.vals[F.tags[i+1]]; return o; }
  function rings(F){ // tile-pixel coordinates, one array per MoveTo
    var g=F.geom,i=0,x=0,y=0,out=[],cur=null;
    while(i<g.length){
      var c=g[i++],id=c&7,n=c>>3;
      if(id===7){ if(cur) cur.close=true; continue; }
      for(var j=0;j<n;j++){
        var dx=g[i++],dy=g[i++]; x+=(dx>>>1)^-(dx&1); y+=(dy>>>1)^-(dy&1);
        if(id===1){ cur=[[x,y]]; out.push(cur); } else cur.push([x,y]);
      }
    }
    return out;
  }
  function lon2t(lon){ return (lon+180)/360*(1<<Z); }
  function lat2t(lat){ var r=lat*Math.PI/180; return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*(1<<Z); }
  function t2lat(t){ var n=Math.PI-2*Math.PI*t/(1<<Z); return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))); }
  function classify(layer,p){
    if(layer==='transportation'){
      if(p.brunnel==='tunnel') return null;
      var c=p['class']||'';
      if(/^(motorway|trunk|primary)$/.test(c)) return 'r1';
      if(/^(secondary|tertiary)$/.test(c)) return 'r2';
      if(c==='minor') return 'r3';
      if(c==='rail') return 'rail';
      return null;
    }
    if(layer==='water') return 'water';
    if(layer==='waterway') return /river|canal/.test(p['class']||'')?'river':null;
    if(layer==='park') return 'park';
    if(layer==='landcover') return (p.subclass==='park'||p.subclass==='garden')?'park':null;
    return null;
  }
  function draw(g){
    var bb=g.getAttribute('data-bb').split(',').map(Number),W=+g.getAttribute('data-w'),H=+g.getAttribute('data-h'),minor=g.getAttribute('data-minor')==='1';
    var x0=Math.floor(lon2t(bb[0])),x1=Math.floor(lon2t(bb[2])),y0=Math.floor(lat2t(bb[3])),y1=Math.floor(lat2t(bb[1]));
    var px=function(tx,ty,ext,p){ var lon=(tx+p[0]/ext)/(1<<Z)*360-180,lat=t2lat(ty+p[1]/ext); return Math.round((lon-bb[0])/(bb[2]-bb[0])*W)+' '+Math.round((bb[3]-lat)/(bb[3]-bb[1])*H); };
    var acc={park:[],water:[],river:[],r3:[],r2:[],r1:[],rail:[]},jobs=[];
    g.setAttribute('data-state','loading');
    return tplUrl().then(function(tpl){
      for(var tx=x0;tx<=x1;tx++) for(var ty=y0;ty<=y1;ty++) (function(tx,ty){
        jobs.push(fetch(tpl.replace('{z}',Z).replace('{x}',tx).replace('{y}',ty)).then(function(r){ if(!r.ok) throw r.status; return r.arrayBuffer(); }).then(function(buf){
          var ls=layers(buf);
          ['water','park','landcover','waterway','transportation'].forEach(function(name){
            var L=ls[name]; if(!L) return;
            L.feats.forEach(function(F){
              var cls=classify(name,props(L,F)); if(!cls||(cls==='r3'&&!minor)) return;
              var poly=F.type===3;
              rings(F).forEach(function(rg){ if(rg.length<2) return; acc[cls].push('M'+rg.map(function(p){return px(tx,ty,L.ext,p);}).join('L')+(poly?'Z':'')); });
            });
          });
        }));
      })(tx,ty);
      return Promise.all(jobs);
    }).then(function(){
      var html='';
      Object.keys(acc).forEach(function(c){ if(acc[c].length){ html+='<path class="rm-'+c+'" d="'+acc[c].join('')+'"/>'; if(c==='rail') html+='<path class="rm-rail-d" d="'+acc[c].join('')+'"/>'; } });
      g.innerHTML=html; g.setAttribute('data-state','ok');
    }).catch(function(){ g.setAttribute('data-state','off'); store.set('hokkaido-tile-tpl',''); });
  }
  function ensure(g){ var st=g&&g.getAttribute('data-state'); if(g&&st!=='ok'&&st!=='loading') return draw(g); return Promise.resolve(); }
  // card thumbnails draw their base map when they scroll into view (that also warms the offline cache)
  var thumbs=[].slice.call(document.querySelectorAll('.rm-thumb'));
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ ensure(e.target.querySelector('.rm-base')); io.unobserve(e.target); } }); },{rootMargin:'200px'});
    thumbs.forEach(function(t){ io.observe(t); });
  } else thumbs.forEach(function(t){ ensure(t.querySelector('.rm-base')); });

  // ---- big map: one floating button, D1–D7 tabs + 全程 ----
  var ovl=document.getElementById('rmOvl'),stage=document.getElementById('rmStage'),pan=document.getElementById('rmPan'),sheet=document.getElementById('rmSheet'),tabs=document.getElementById('rmTabs');
  var view={s:1,x:0,y:0,base:1,day:1},backToRm=false;
  function apply(){ pan.style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.s+')'; }
  function fit(){
    var svg=pan.querySelector('svg'); if(!svg) return;
    var vb=svg.viewBox.baseVal,W=stage.clientWidth,H=stage.clientHeight;
    svg.style.width=vb.width+'px'; svg.style.height=vb.height+'px';
    view.base=Math.min(W/vb.width,H/vb.height);
    // wide maps (e.g. Otaru) start zoomed to fill most of the height; drag sideways to see the rest
    view.s=Math.min(Math.max(view.base,H*0.82/vb.height),view.base*1.35);
    view.x=(W-vb.width*view.s)/2; view.y=(H-vb.height*view.s)/2; apply();
  }
  function zoomAt(f,cx,cy){
    var s=Math.max(view.base*0.8,Math.min(view.base*6,view.s*f)); f=s/view.s;
    view.x=cx-(cx-view.x)*f; view.y=cy-(cy-view.y)*f; view.s=s; apply();
  }
  function rmTabs(){
    var h='<button class="map-chip" type="button" data-day="0">全程 · 全道</button>';
    for(var d=1;d<=7;d++){ var c=document.querySelector('.route-map[data-day="'+d+'"]'); if(!c) continue;
      h+='<button class="map-chip'+(view.day===d?' active':'')+'" type="button" data-day="'+d+'"><i style="background:'+c.style.getPropertyValue('--day')+'"></i>D'+d+'</button>'; }
    tabs.innerHTML=h;
  }
  function show(d){
    var card=document.querySelector('.route-map[data-day="'+d+'"]'); if(!card) return;
    view.day=d; rmTabs();
    var svg=card.querySelector('.rm-svg').cloneNode(true); svg.removeAttribute('preserveAspectRatio');
    pan.innerHTML=''; pan.appendChild(svg);
    var g=svg.querySelector('.rm-base'); if(g.getAttribute('data-state')!=='ok'){ g.removeAttribute('data-state'); ensure(g); }
    var more=card.querySelector('.rm-more').cloneNode(true); more.hidden=false;
    sheet.style.setProperty('--day',card.style.getPropertyValue('--day'));
    sheet.innerHTML=''; sheet.appendChild(more);
    var gm=document.querySelector('#d'+d+' a.gmap'); if(gm){ var a=gm.cloneNode(true); sheet.appendChild(a); }
    requestAnimationFrame(function(){ requestAnimationFrame(fit); });
  }
  function openRm(d){ ovl.hidden=false; document.body.style.overflow='hidden'; show(d||view.day); }
  function closeRm(){ ovl.hidden=true; document.body.style.overflow=''; }
  var todayN=today?tripDays.indexOf(today)+1:1; view.day=todayN;
  document.getElementById('rmFab').addEventListener('click',function(){ openRm(); });
  document.getElementById('rmClose').addEventListener('click',closeRm);
  thumbs.forEach(function(t){ t.addEventListener('click',function(){ openRm(+t.getAttribute('data-day')); }); });
  tabs.addEventListener('click',function(e){
    var b=e.target.closest('[data-day]'); if(!b) return;
    var d=+b.getAttribute('data-day');
    if(d===0){ closeRm(); backToRm=true; mapPickDay(0); mapOpenOvl(); return; }
    show(d);
  });
  // the old top-bar 地图 chip now opens the same big map
  var oldOpen=document.getElementById('mapOpen');
  if(oldOpen){ var nb=oldOpen.cloneNode(true); oldOpen.parentNode.replaceChild(nb,oldOpen); nb.addEventListener('click',function(){ openRm(); }); }
  // back from 全程 to the big map
  document.getElementById('mapClose').addEventListener('click',function(){ if(backToRm){ backToRm=false; openRm(); } });
  addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    if(!mapOvl.hidden){ if(backToRm){ backToRm=false; setTimeout(function(){ openRm(); },0); } return; }
    if(!ovl.hidden&&![].slice.call(document.querySelectorAll('.menu-modal,.phrase-ovl,.taxi-ovl,.ord-ovl')).some(function(o){return !o.hidden;})){ closeRm(); e.stopImmediatePropagation(); }
  },true);
  document.querySelector('.rm-zoom').addEventListener('click',function(e){
    var b=e.target.closest('[data-z]'); if(!b) return;
    var z=+b.getAttribute('data-z'); if(!z){ fit(); return; }
    zoomAt(z,stage.clientWidth/2,stage.clientHeight/2);
  });
  // drag to pan, pinch / wheel / double-tap to zoom
  var pts={},last=null,lastTap=0;
  function rel(e){ var r=stage.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
  stage.addEventListener('pointerdown',function(e){
    if(e.target.closest('.rm-zoom')) return;
    stage.setPointerCapture(e.pointerId); pts[e.pointerId]=rel(e); last=null;
    var now=Date.now(); if(now-lastTap<300&&Object.keys(pts).length===1){ var p=rel(e); zoomAt(2,p.x,p.y); } lastTap=now;
  });
  stage.addEventListener('pointermove',function(e){
    if(!pts[e.pointerId]) return;
    var p=rel(e),ids=Object.keys(pts);
    if(ids.length===1){ view.x+=p.x-pts[e.pointerId].x; view.y+=p.y-pts[e.pointerId].y; apply(); }
    else if(ids.length===2){
      pts[e.pointerId]=p; var a=pts[ids[0]],b=pts[ids[1]],d=Math.hypot(a.x-b.x,a.y-b.y),c={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(last){ zoomAt(d/last.d,c.x,c.y); view.x+=c.x-last.c.x; view.y+=c.y-last.c.y; apply(); }
      last={d:d,c:c}; return;
    }
    pts[e.pointerId]=p;
  });
  function up(e){ delete pts[e.pointerId]; last=null; }
  stage.addEventListener('pointerup',up); stage.addEventListener('pointercancel',up);
  stage.addEventListener('wheel',function(e){ e.preventDefault(); var p=rel(e); zoomAt(e.deltaY<0?1.15:0.87,p.x,p.y); },{passive:false});
  addEventListener('resize',function(){ if(!ovl.hidden) fit(); });
})();
