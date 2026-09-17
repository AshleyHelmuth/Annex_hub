/* scheduling.js — Scheduling tab: one-click equipment booking (writes to the
 * shared Google equipment calendars via /api/book on the same service account
 * the inventory uses) plus a merged overlaid calendar view. */
window.Scheduling = (function(){
  var TZ='America/New_York';
  // Equipment -> its Google group calendar id, colour, and default reservation window.
  // (Same calendars/colours as the singlecell-planner. Tapestation is walk-up: no reservation.)
  var EQUIPMENT=[
    { name:'BSC1',                   cal:'fe7836fa02ee2dbf37165fb6342df868b6878766c4212182925d5296cdddec52@group.calendar.google.com', color:'#1f7a7a', start:'07:00', end:'22:00' },
    { name:'BSC2',                   cal:'fa259394976287b42162f6bae0794beb7fd80178cdd1f075f2383f76f3eb9525@group.calendar.google.com', color:'#2f7d53', start:'07:00', end:'22:00' },
    { name:'Chemical Hood',          cal:'1761540d25c59e44726fa9780cd8d35d889f4505525802b9133708d636655c13@group.calendar.google.com', color:'#8a6d1f', start:'09:00', end:'17:00' },
    { name:'Swing Bucket Centrifuge',cal:'e6a9fe5cdee1eee46fe8f31ef6fd3495da881305b390862b5cdf017c17357a5d@group.calendar.google.com', color:'#b0611f', start:'07:00', end:'22:00' },
    { name:'Table Centrifuge',       cal:'203a7d3f0e735031b57d97d28c421222c9624d345b67fd65f99c71f71dfcd444@group.calendar.google.com', color:'#a0742f', start:'07:00', end:'22:00' },
    { name:'Sony Sorter',            cal:'1ad41eb20eb6b5f546119f6eb8da207d1274599276bcc224e8141325afc4346b@group.calendar.google.com', color:'#6b4fa3', start:'07:00', end:'17:00' },
    { name:'Chromium X',             cal:'f6113753a09a8128a9612bdda61e105c93221f89fffa2ce38c8f74631b950ed0@group.calendar.google.com', color:'#2f5c8f', start:'10:00', end:'22:00' },
    { name:'Thermocycler 1',         cal:'ac9d4e86a5b292de20497a7961f70875cc0ed4f206f65543a45f164e852c019c@group.calendar.google.com', color:'#5b6570', start:'10:00', end:'22:00' },
    { name:'Thermocycler 2',         cal:'88f86d0eb68666076b01a1cd5830a5b58d23f288abbe14cb1f0cb542858448cc@group.calendar.google.com', color:'#7a5b8f', start:'10:00', end:'22:00' },
    { name:'Tapestation',            cal:'1d8a15eb34be699ed8d28d9b3304dbcbc835e1fad452fb156b958cb21751f935@group.calendar.google.com', color:'#ab3939', noReserve:true }
  ];
  var mounted=false;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function gname(){ try{ return localStorage.getItem('annexhub_name')||localStorage.getItem('annexhub_who')||''; }catch(e){ return ''; } }
  function setName(v){ try{ localStorage.setItem('annexhub_name', v||''); }catch(e){} }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function embedUrl(){
    var base='https://calendar.google.com/calendar/embed?ctz='+encodeURIComponent(TZ)+'&mode=WEEK&showTitle=0&showPrint=0&showTz=0&showCalendars=1&wkst=1';
    EQUIPMENT.forEach(function(e){ base+='&src='+encodeURIComponent(e.cal)+'&color='+encodeURIComponent(e.color); });
    return base;
  }

  function mount(){
    var host=document.getElementById('view-scheduling'); if(!host) return;
    if(mounted){ return; } mounted=true;
    var rows=EQUIPMENT.map(function(e,i){
      if(e.noReserve){
        return '<div class="sch-row noresv"><span class="sw" style="background:'+e.color+'"></span>'+
          '<span class="eq-name">'+esc(e.name)+'</span>'+
          '<span class="eq-note">walk-up · no reservation needed</span></div>';
      }
      return '<div class="sch-row" data-i="'+i+'">'+
        '<label class="eq-pick"><input type="checkbox" class="eq-chk" data-i="'+i+'"><span class="sw" style="background:'+e.color+'"></span>'+
        '<span class="eq-name">'+esc(e.name)+'</span></label>'+
        '<span class="eq-times"><input type="time" class="eq-start" data-i="'+i+'" value="'+e.start+'"> – '+
        '<input type="time" class="eq-end" data-i="'+i+'" value="'+e.end+'"></span></div>';
    }).join('');

    host.innerHTML='<div class="content">'+
      '<div class="page-head"><div><h1>Scheduling</h1><div class="sub">Reserve Annex equipment — bookings are written straight to each instrument\u2019s shared Google Calendar.</div></div></div>'+
      '<div id="schMsg"></div>'+
      '<div class="panel">'+
        '<div class="grid2"><div class="field"><label>Your name</label><input id="sch_name" placeholder="e.g. Ashley Helmuth" value="'+esc(gname())+'"></div>'+
        '<div class="field"><label>Date</label><input id="sch_date" type="date" value="'+todayISO()+'"></div></div>'+
        '<div class="field"><label>Purpose (optional)</label><input id="sch_purpose" placeholder="e.g. BCP batch 13 GEM prep"></div>'+
        '<div class="field"><label>Equipment</label>'+
          '<div class="sch-toolbar"><button class="btn btn-sm" id="sch_all">Select all</button><button class="btn btn-sm" id="sch_none">Clear</button></div>'+
          '<div class="sch-list">'+rows+'</div></div>'+
        '<div class="row-actions"><button class="btn btn-primary" id="sch_book">Book selected</button></div>'+
        '<div id="sch_results"></div>'+
      '</div>'+
      '<div class="panel">'+
        '<div class="page-head" style="margin-bottom:8px"><div><h2>All equipment calendars</h2><div class="sub">Every instrument overlaid in one view.</div></div>'+
          '<button class="btn btn-sm" id="sch_refresh">↻ Refresh</button></div>'+
        '<div class="sch-legend">'+EQUIPMENT.map(function(e){return '<span class="lg"><span class="sw" style="background:'+e.color+'"></span>'+esc(e.name)+'</span>';}).join('')+'</div>'+
        '<div class="sch-embed"><iframe id="sch_iframe" src="'+embedUrl()+'" style="border:0" frameborder="0" scrolling="no"></iframe></div>'+
      '</div>'+
    '</div>';

    document.getElementById('sch_name').onchange=function(){ setName(this.value.trim()); };
    document.getElementById('sch_all').onclick=function(){ toggleAll(true); };
    document.getElementById('sch_none').onclick=function(){ toggleAll(false); };
    document.getElementById('sch_book').onclick=bookSelected;
    document.getElementById('sch_refresh').onclick=function(){ var f=document.getElementById('sch_iframe'); f.src=f.src; };
    checkConfigured();
  }
  function toggleAll(on){ Array.prototype.forEach.call(document.querySelectorAll('.eq-chk'),function(c){ c.checked=on; }); }

  function checkConfigured(){
    fetch('/api/book').then(function(r){return r.json();}).then(function(d){
      if(d && d.configured===false){ document.getElementById('schMsg').innerHTML='<div class="error-box">Booking isn\u2019t live yet — the <b>GOOGLE_SA_KEY</b> secret isn\u2019t set on this Worker. The calendar view below still works; add the key to enable one-click booking.</div>'; }
    }).catch(function(){});
  }

  function bookSelected(){
    var name=(document.getElementById('sch_name').value||'').trim();
    var date=document.getElementById('sch_date').value;
    var purpose=(document.getElementById('sch_purpose').value||'').trim();
    if(!date){ toast('Pick a date', true); return; }
    var picks=[];
    Array.prototype.forEach.call(document.querySelectorAll('.eq-chk'),function(c){
      if(!c.checked) return; var i=+c.getAttribute('data-i');
      var s=document.querySelector('.eq-start[data-i="'+i+'"]').value;
      var e=document.querySelector('.eq-end[data-i="'+i+'"]').value;
      picks.push({ i:i, eq:EQUIPMENT[i], start:s, end:e });
    });
    if(!picks.length){ toast('Select at least one instrument', true); return; }
    if(!name){ toast('Enter your name first', true); return; }
    setName(name);
    var res=document.getElementById('sch_results'); res.innerHTML='<div class="hint">Booking…</div>';
    var out=[];
    // sequential to keep clear per-item results
    (function next(k){
      if(k>=picks.length){ renderResults(out); return; }
      var p=picks[k];
      book(p, name, date, purpose, false, function(r){ out.push({p:p, r:r}); next(k+1); });
    })(0);
  }
  function book(p, name, date, purpose, force, cb){
    fetch('/api/book', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ calendarId:p.eq.cal, equipment:p.eq.name, date:date, start:p.start, end:p.end, tz:TZ, by:name, purpose:purpose, force:force }) })
      .then(function(r){return r.json();}).then(cb).catch(function(e){ cb({ok:false,error:String(e)}); });
  }
  function renderResults(out){
    var res=document.getElementById('sch_results');
    var okN=out.filter(function(o){return o.r&&o.r.ok;}).length;
    var html='<div style="margin-top:10px">';
    out.forEach(function(o,idx){
      var e=o.p.eq, r=o.r;
      if(r&&r.ok){
        html+='<div class="sch-result ok"><b>'+esc(e.name)+'</b> booked '+esc(o.p.start)+'–'+esc(o.p.end)+(r.forced?' (over a conflict)':'')+(r.htmlLink?' · <a href="'+esc(r.htmlLink)+'" target="_blank" rel="noopener">view</a>':'')+'</div>';
      } else if(r&&r.conflict){
        var c=(r.conflicts||[]).map(function(x){return esc(x.summary)+' ('+fmtT(x.start)+'–'+fmtT(x.end)+')';}).join(', ');
        html+='<div class="sch-result conflict" data-ci="'+idx+'"><b>'+esc(e.name)+'</b> — conflicts with '+c+' <button class="btn btn-sm btn-danger" data-force="'+idx+'">Book anyway</button></div>';
      } else {
        html+='<div class="sch-result err"><b>'+esc(e.name)+'</b> — '+esc((r&&r.error)||'failed')+'</div>';
      }
    });
    html+='</div>';
    res.innerHTML=html;
    if(okN){ var f=document.getElementById('sch_iframe'); if(f) f.src=f.src; toast('Booked '+okN+' instrument'+(okN===1?'':'s')); }
    // wire "Book anyway"
    Array.prototype.forEach.call(res.querySelectorAll('[data-force]'),function(btn){
      btn.onclick=function(){
        var idx=+btn.getAttribute('data-force'); var o=out[idx];
        var name=(document.getElementById('sch_name').value||'').trim();
        var date=document.getElementById('sch_date').value;
        var purpose=(document.getElementById('sch_purpose').value||'').trim();
        btn.disabled=true; btn.textContent='Booking…';
        book(o.p, name, date, purpose, true, function(r){ o.r=r; renderResults(out); });
      };
    });
  }
  function fmtT(iso){ try{ var d=new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){ return iso; } }
  function toast(m,e){ if(window.App&&App.toast) App.toast(m,e); }

  return { mount:mount };
})();
