/* scheduling.js — Scheduling tab: one-click equipment booking (writes to the
 * shared Google equipment calendars via /api/book on the same service account
 * the inventory uses) plus a merged overlaid calendar view. */
window.Scheduling = (function(){
  var TZ='America/New_York';
  // Equipment -> its Google group calendar id, colour, and default reservation window.
  // (Same calendars/colours as the singlecell-planner. Tapestation is walk-up: no reservation.)
  var EQUIPMENT=[
    { name:'BSC1',                      cal:'fe7836fa02ee2dbf37165fb6342df868b6878766c4212182925d5296cdddec52@group.calendar.google.com', color:'#1f7a7a', start:'07:00', end:'22:00' },
    { name:'BSC2',                      cal:'fa259394976287b42162f6bae0794beb7fd80178cdd1f075f2383f76f3eb9525@group.calendar.google.com', color:'#2f7d53', start:'07:00', end:'22:00' },
    { name:'RNA hood',                  cal:'cff1a5f3a88e14c99f2da2984451f6a4065b462e58e0c6e4f1a9261ef2879604@group.calendar.google.com', color:'#4f8f3a', start:'09:00', end:'17:00' },
    { name:'Chemical Fume Hood',        cal:'1761540d25c59e44726fa9780cd8d35d889f4505525802b9133708d636655c13@group.calendar.google.com', color:'#8a6d1f', start:'09:00', end:'17:00' },
    { name:'Swing Bucket Centrifuge',   cal:'e6a9fe5cdee1eee46fe8f31ef6fd3495da881305b390862b5cdf017c17357a5d@group.calendar.google.com', color:'#b0611f', start:'07:00', end:'22:00' },
    { name:'Table Centrifuge',          cal:'203a7d3f0e735031b57d97d28c421222c9624d345b67fd65f99c71f71dfcd444@group.calendar.google.com', color:'#a0742f', start:'07:00', end:'22:00' },
    { name:'Floor centrifuge',          cal:'b4f04e4daaed9185f2b0364d219553c0c63f742fcbed4477dfeadbf8b2d8d04b@group.calendar.google.com', color:'#7a4a2a', start:'07:00', end:'22:00' },
    { name:'Sony Sorter',               cal:'1ad41eb20eb6b5f546119f6eb8da207d1274599276bcc224e8141325afc4346b@group.calendar.google.com', color:'#6b4fa3', start:'07:00', end:'17:00' },
    { name:'Sony ID7000 Flow cytometer',cal:'af47c5a45c9020de2a1ae9ca69caa1aa645dcbb74e6009f37e2df413fb88aee5@group.calendar.google.com', color:'#4a4fa5', start:'09:00', end:'17:00' },
    { name:'Chromium X',                cal:'f6113753a09a8128a9612bdda61e105c93221f89fffa2ce38c8f74631b950ed0@group.calendar.google.com', color:'#2f5c8f', start:'10:00', end:'22:00' },
    { name:'Thermocycler 1',            cal:'ac9d4e86a5b292de20497a7961f70875cc0ed4f206f65543a45f164e852c019c@group.calendar.google.com', color:'#5b6570', start:'10:00', end:'22:00' },
    { name:'Thermocycler 2',            cal:'88f86d0eb68666076b01a1cd5830a5b58d23f288abbe14cb1f0cb542858448cc@group.calendar.google.com', color:'#7a5b8f', start:'10:00', end:'22:00' },
    { name:'qPCR',                      cal:'1cfb2d1153ef0369915d285904f6c344aa0caa4193a3d379ba763590838c159f@group.calendar.google.com', color:'#b03a6e', start:'10:00', end:'22:00' },
    { name:'Cellaca',                   cal:'7b03186b560872a1f3b826de599b0993f82783b3e88f91d6ca960f8fd11f416f@group.calendar.google.com', color:'#c77f0e', start:'09:00', end:'17:00' },
    { name:'Tapestation',               cal:'1d8a15eb34be699ed8d28d9b3304dbcbc835e1fad452fb156b958cb21751f935@group.calendar.google.com', color:'#ab3939', noReserve:true }
  ];
  function normCal(id){ return String(id||'').replace(/%40/gi,'@').trim(); } // tolerate a pasted %40
  var mounted=false;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function gname(){ try{ return localStorage.getItem('annexhub_name')||localStorage.getItem('annexhub_who')||''; }catch(e){ return ''; } }
  function setName(v){ try{ localStorage.setItem('annexhub_name', v||''); }catch(e){} }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function embedUrl(){
    var base='https://calendar.google.com/calendar/embed?ctz='+encodeURIComponent(TZ)+'&mode=WEEK&showTitle=0&showPrint=0&showTz=0&showCalendars=1&wkst=1';
    EQUIPMENT.forEach(function(e){ base+='&src='+encodeURIComponent(normCal(e.cal))+'&color='+encodeURIComponent(e.color); });
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
      '<div class="page-head"><div><h1>Equipment scheduling</h1><div class="sub">Reserve Annex equipment — bookings are written straight to each instrument\u2019s shared Google Calendar.</div></div></div>'+
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
        '<div class="page-head" style="margin-bottom:8px"><div><h2>Upcoming bookings</h2><div class="sub">Next 30 days — delete a reservation you need to remove.</div></div>'+
          '<button class="btn btn-sm" id="sch_bkrefresh">↻ Refresh</button></div>'+
        '<div id="sch_bookings"><div class="hint">Loading…</div></div>'+
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
    document.getElementById('sch_bkrefresh').onclick=loadBookings;
    checkConfigured();
    loadBookings();
  }

  function loadBookings(){
    var host=document.getElementById('sch_bookings'); if(host) host.innerHTML='<div class="hint">Loading…</div>';
    var cals=EQUIPMENT.map(function(e){ return { id:normCal(e.cal), name:e.name }; });
    fetch('/api/events', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ action:'list', calendars:cals, days:30 }) })
      .then(function(r){return r.json();}).then(function(d){
        if(!d||!d.ok){ if(host) host.innerHTML='<div class="hint">'+esc((d&&d.error)||'Could not load bookings')+'</div>'; return; }
        renderBookings(d.events||[]);
      }).catch(function(){ if(host) host.innerHTML='<div class="hint">Could not load bookings.</div>'; });
  }
  function colorFor(name){ var e=EQUIPMENT.filter(function(x){return x.name===name;})[0]; return e?e.color:'#888'; }
  function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return iso; } }
  function bookedBy(desc){ var m=(desc||'').match(/Booked by:\s*(.+)/i); return m?m[1].trim():''; }
  function renderBookings(events){
    var host=document.getElementById('sch_bookings'); if(!host) return;
    if(!events.length){ host.innerHTML='<div class="empty">No bookings in the next 30 days.</div>'; return; }
    host.innerHTML=events.map(function(ev,i){
      var by=bookedBy(ev.description);
      return '<div class="bk-row">'+
        '<span class="sw" style="background:'+colorFor(ev.equipment)+'"></span>'+
        '<div class="bk-main"><div class="bk-top"><b>'+esc(ev.equipment)+'</b> <span class="bk-when">'+esc(fmtDate(ev.start))+' · '+esc(fmtT(ev.start))+(ev.end?('–'+esc(fmtT(ev.end))):'')+'</span></div>'+
          '<div class="bk-sum">'+esc(ev.summary||'')+(by?(' · '+esc(by)):'')+'</div></div>'+
        '<button class="btn btn-sm btn-danger" data-del="'+i+'">Delete</button>'+
      '</div>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-del]'),function(b){
      b.onclick=function(){ confirmDelete(events[+b.getAttribute('data-del')]); };
    });
  }
  function confirmDelete(ev){
    if(!ev) return; var by=bookedBy(ev.description);
    var msg=ev.equipment+' · '+fmtDate(ev.start)+' '+fmtT(ev.start)+(ev.summary?('\n'+ev.summary):'')+(by?('\nBooked by '+by):'');
    if(window.App && App.drawer){
      App.drawer('Delete booking', '<p style="margin:0 0 16px;white-space:pre-line">Delete this booking?\n\n'+esc(msg)+'</p><div class="row-actions"><button class="btn" id="bk_no">Back</button><button class="btn btn-danger" id="bk_yes">Delete</button></div>');
      document.getElementById('bk_no').onclick=function(){ App.closeDrawer(); };
      document.getElementById('bk_yes').onclick=function(){ App.closeDrawer(); doDelete(ev); };
    } else { doDelete(ev); }
  }
  function doDelete(ev){
    fetch('/api/events', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ action:'delete', calendarId:ev.calendarId, eventId:ev.eventId }) })
      .then(function(r){return r.json();}).then(function(d){
        if(d&&d.ok){ toast('Booking deleted'); loadBookings(); var f=document.getElementById('sch_iframe'); if(f) f.src=f.src; }
        else { toast('Error: '+((d&&d.error)||'could not delete'), true); }
      }).catch(function(){ toast('Network error', true); });
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
      body: JSON.stringify({ calendarId:normCal(p.eq.cal), equipment:p.eq.name, date:date, start:p.start, end:p.end, tz:TZ, by:name, purpose:purpose, force:force }) })
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
    if(okN){ var f=document.getElementById('sch_iframe'); if(f) f.src=f.src; toast('Booked '+okN+' instrument'+(okN===1?'':'s')); loadBookings(); }
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
