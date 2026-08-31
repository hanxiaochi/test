"use strict";

function costCalculatorPageHtml() {
  return `
    <div class="layui-fluid cost-calculator-page">
      <style>
        .cost-calculator-page { padding:16px; background:#f5f7fb; color:#172033; }
        .calc-shell { max-width:1180px; margin:0 auto; }
        .calc-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .calc-head h2 { margin:0; font-size:22px; font-weight:600; }
        .calc-head p { margin:6px 0 0; color:#64748b; }
        .calc-grid { display:grid; grid-template-columns:repeat(2, minmax(280px, 1fr)); gap:12px; }
        .calc-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; }
        .calc-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .calc-row { display:grid; grid-template-columns:110px 1fr; gap:8px; align-items:center; margin-bottom:8px; }
        .calc-row label { color:#475569; }
        .calc-row input { height:30px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; }
        .calc-result { display:grid; grid-template-columns:repeat(4, minmax(120px, 1fr)); gap:10px; margin-top:12px; }
        .calc-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:12px; }
        .calc-card span { display:block; color:#64748b; font-size:12px; }
        .calc-card strong { display:block; margin-top:8px; color:#0f766e; font-size:18px; }
        .calc-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .calc-detail { margin-top:12px; background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:12px; }
        .calc-detail h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .calc-detail td, .calc-detail th { white-space:nowrap; }
        .calc-empty { color:#94a3b8; text-align:center; padding:18px; }
        @media (max-width:900px) { .calc-grid { grid-template-columns:1fr; } .calc-result { grid-template-columns:1fr 1fr; } .calc-head { align-items:flex-start; flex-direction:column; } }
      </style>
      <div class="calc-shell">
        <div class="calc-head">
          <div>
            <h2>造价计算器</h2>
            <p>按清单、变更、材料补差、材料到场和手动计量即时测算合同金额、最终金额、应付金额和支付比例。</p>
          </div>
          <div class="calc-actions">
            <button class="layui-btn layui-btn-sm layui-btn-primary" id="calc-run">计算</button>
            <button class="layui-btn layui-btn-sm layui-btn-normal" id="calc-ledger">载入当前台账</button>
          </div>
        </div>
        <form id="cost-calculator-form" class="calc-grid">
          <div class="calc-panel">
            <h3>清单计量</h3>
            <div class="calc-row"><label>清单编号</label><input name="billNo" value="101-1"></div>
            <div class="calc-row"><label>清单名称</label><input name="billName" value="临时道路"></div>
            <div class="calc-row"><label>合同数量</label><input name="quantity" value="100"></div>
            <div class="calc-row"><label>综合单价</label><input name="price" value="10"></div>
            <div class="calc-row"><label>计量数量</label><input name="measureNum" value="40"></div>
          </div>
          <div class="calc-panel">
            <h3>工程变更</h3>
            <div class="calc-row"><label>变更编号</label><input name="varyNo" value="BG-CALC-001"></div>
            <div class="calc-row"><label>变更前数量</label><input name="beforeNum" value="100"></div>
            <div class="calc-row"><label>变更前单价</label><input name="beforePrice" value="10"></div>
            <div class="calc-row"><label>变更后数量</label><input name="afterNum" value="120"></div>
            <div class="calc-row"><label>变更后单价</label><input name="afterPrice" value="10"></div>
          </div>
          <div class="calc-panel">
            <h3>材料补差/到场</h3>
            <div class="calc-row"><label>材料编号</label><input name="materialNo" value="CL-001"></div>
            <div class="calc-row"><label>材料名称</label><input name="materialName" value="钢筋"></div>
            <div class="calc-row"><label>补差数量</label><input name="materialQuantity" value="5"></div>
            <div class="calc-row"><label>基准价</label><input name="basePrice" value="10"></div>
            <div class="calc-row"><label>现行价</label><input name="currentPrice" value="13"></div>
            <div class="calc-row"><label>到场数量</label><input name="arrivalQuantity" value="8"></div>
          </div>
          <div class="calc-panel">
            <h3>手动计量</h3>
            <div class="calc-row"><label>清单编号</label><input name="manualBillNo" value="900-1"></div>
            <div class="calc-row"><label>清单名称</label><input name="manualBillName" value="零星工程"></div>
            <div class="calc-row"><label>计量数量</label><input name="manualQuantity" value="1"></div>
            <div class="calc-row"><label>单价</label><input name="manualPrice" value="50"></div>
          </div>
        </form>
        <div class="calc-result" id="cost-calculator-result">
          <div class="calc-card"><span>合同金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>最终金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>应付金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>支付比例</span><strong>0.00%</strong></div>
        </div>
        <div class="calc-detail">
          <h3>材料联动台账</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>补差数量</th><th>补差金额</th><th>到场数量</th><th>到场金额</th><th>覆盖率</th></tr></thead>
            <tbody id="cost-calculator-ledger"><tr><td colspan="7" class="calc-empty">暂无计算结果</td></tr></tbody>
          </table>
        </div>
      </div>
      <script>
        (function(){
          function value(name){ return document.querySelector('[name="'+name+'"]').value; }
          function money(value){ return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
          function fetchJson(url){ return fetch(url).then(function(r){ return r.json(); }).then(function(r){ return r.data || []; }); }
          function rowValue(row, names){ for(var i=0;i<names.length;i++){ if(row[names[i]] !== undefined && row[names[i]] !== null && row[names[i]] !== '') return row[names[i]]; } return ''; }
          function render(data){
            document.getElementById('cost-calculator-result').innerHTML = [
              ['合同金额', money(data.contractMoney)],
              ['变更金额', money(data.variationMoney)],
              ['最终金额', money(data.finalMoney)],
              ['清单计量', money(data.measuredMoney)],
              ['材料补差', money(data.materialAdjustMoney)],
              ['材料到场', money(data.materialArrivalMoney) + '（跟踪）'],
              ['手动计量', money(data.manualMoney)],
              ['应付金额', money(data.payableMoney) + ' / ' + money(data.payRate) + '%']
            ].map(function(row){ return '<div class="calc-card"><span>'+row[0]+'</span><strong>'+row[1]+'</strong></div>'; }).join('');
            var ledger = (((data.details || {}).materialLedger) || []);
            document.getElementById('cost-calculator-ledger').innerHTML = ledger.length ? ledger.map(function(row){
              return '<tr><td>'+ (row.materialNo || '') +'</td><td>'+ (row.materialName || '') +'</td><td>'+ money(row.diasQuantity) +'</td><td>'+ money(row.diasMoney) +'</td><td>'+ money(row.arrivalQuantity) +'</td><td>'+ money(row.arrivalMoney) +'</td><td>'+ money(row.coverageRate) +'%</td></tr>';
            }).join('') : '<tr><td colspan="7" class="calc-empty">暂无材料联动台账</td></tr>';
          }
          function calculate(payload){
            fetch('/api/cost/calculate', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(payload)
            }).then(function(r){ return r.json(); }).then(function(r){ render(r.data || {}); });
          }
          document.getElementById('calc-run').onclick = function(){
            calculate({
                bills:[{ billNo:value('billNo'), billName:value('billName'), quantity:Number(value('quantity')), price:Number(value('price')), measureNum:Number(value('measureNum')) }],
                measures:[{ billNo:value('billNo'), measureNum:Number(value('measureNum')) }],
                variations:[{ varyNo:value('varyNo'), beforeNum:Number(value('beforeNum')), beforePrice:Number(value('beforePrice')), afterNum:Number(value('afterNum')), afterPrice:Number(value('afterPrice')) }],
                materialAdjustments:[{ materialNo:value('materialNo'), materialName:value('materialName'), quantity:Number(value('materialQuantity')), basePrice:Number(value('basePrice')), currentPrice:Number(value('currentPrice')) }],
                materialArrivals:[{ materialNo:value('materialNo'), materialName:value('materialName'), quantity:Number(value('arrivalQuantity')), price:Number(value('currentPrice')) }],
                manualMeasures:[{ billNo:value('manualBillNo'), billName:value('manualBillName'), quantity:Number(value('manualQuantity')), price:Number(value('manualPrice')) }]
              });
          };
          document.getElementById('calc-ledger').onclick = function(){
            Promise.all([
              fetchJson('/api/cost/bills?page=1&limit=10000'),
              fetchJson('/vary_measure/list?page=1&limit=10000'),
              fetchJson('/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=10000'),
              fetchJson('/meterialInMeasure/meterial_in_measure_list?page=1&limit=10000'),
              fetchJson('/manualMeasure/detail_list?page=1&limit=10000')
            ]).then(function(all){
              calculate({
                bills: all[0].map(function(row){ return { billId:row.billId, billNo:row.billNo, billName:row.billName, quantity:row.contractNum || row.quantity, price:row.price, measureNum:row.measuredNum }; }),
                variations: all[1].map(function(row){ return { varyNo:row.varyNo, varyReason:row.varyReason, beforeNum:row.beforeNum, beforePrice:row.beforePrice, afterNum:row.afterNum, afterPrice:row.afterPrice }; }),
                materialAdjustments: all[2].map(function(row){ return { materialNo:row.materialNo, materialName:row.materialName, quantity:row.quantity || row.measureNum, basePrice:row.basePrice, currentPrice:row.currentPrice }; }),
                materialArrivals: all[3].map(function(row){ return { materialNo:row.materialNo, materialName:row.materialName, quantity:row.quantity || row.measureNum, price:row.price || row.currentPrice || row.measurePrice }; }),
                manualMeasures: all[4].map(function(row){ return { billNo:row.billNo, billName:row.billName, quantity:row.measureNum || row.quantity, price:row.price }; })
              });
            });
          };
          document.getElementById('calc-run').click();
        })();
      </script>
    </div>`;
}

module.exports = { costCalculatorPageHtml };
