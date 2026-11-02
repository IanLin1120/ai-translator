/* ============================================================
   5. GENERIC DROPZONE WIRING
   ============================================================ */
function wireDropzone(dzId, inputId, onFile){
  var dz = document.getElementById(dzId);
  var input = document.getElementById(inputId);
  dz.addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){
    if(input.files[0]) onFile(input.files[0]);
  });
  dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', function(){ dz.classList.remove('drag'); });
  dz.addEventListener('drop', function(e){
    e.preventDefault(); dz.classList.remove('drag');
    if(e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
}
function showChip(containerId, filename, onRemove){
  var c = document.getElementById(containerId);
  c.innerHTML = '';
  var chip = document.createElement('div');
  chip.className = 'file-chip';
  chip.innerHTML = '<span>📄 '+escapeXml(filename)+'</span>';
  var rm = document.createElement('button');
  rm.textContent = '✕';
  rm.addEventListener('click', onRemove);
  chip.appendChild(rm);
  c.appendChild(chip);
}

