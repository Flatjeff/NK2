
(function() {
  const REPO   = 'Flatjeff/NK2';
  const BRANCH = 'main';
  let adminMode = false;

  // Token obfusqué ROT+base64
  function rotDecode(enc, shift) {
    const raw = atob(enc);
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode((raw.charCodeAt(i) - shift + 256) % 256);
    }
    return out;
  }
  const _ENC = 'lpefjoZ/fp98l2GTqZRooXOUfZ90kXiGpYB9eIZjlYCQYV+anYWSdg==';
  let ghToken = rotDecode(_ENC, 47);
  let currentTarget = null;
  let currentType   = null; // 'text' | 'image'
  let pendingImageB64 = null;
  let pendingImageName = null;

  // ── Utils ──────────────────────────────────────────────
  function toast(msg, dur=3000) {
    const t = document.getElementById('admin-toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
  }

  function pad(n) { return String(n).padStart(2,'0'); }

  function timestamp() {
    const d = new Date();
    return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${String(d.getFullYear()).slice(2)}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  // ── Tag des éléments éditables ─────────────────────────
  function tagEditables() {
    // Cibler les <p> et <td> contenant du texte, y compris via des spans imbriqués
    document.querySelectorAll('p, td, h1, h2, h3, h4').forEach(el => {
      const text = el.textContent.trim();
      if (text.length < 2) return;
      // Exclure les éléments de l'UI admin
      if (el.closest('#admin-bar, #admin-overlay, #admin-toast')) return;
      // Exclure si ne contient que des images (wrappers visuels)
      const allNodes = Array.from(el.querySelectorAll('*'));
      const onlyImgWrappers = allNodes.every(n =>
        n.tagName === 'IMG' || n.tagName === 'SPAN' && n.style && n.style.overflow === 'hidden'
      );
      if (onlyImgWrappers && el.querySelectorAll('img').length > 0 && text.length < 5) return;
      el.setAttribute('data-editable', '1');
    });
    // Images — exclure uniquement les petites puces/icônes décoratives (taille réelle < 40px),
    // pas par nom de fichier (fragile : Google Docs renomme les images à chaque export)
    document.querySelectorAll('img').forEach(el => {
      const w = el.getBoundingClientRect().width || parseInt(el.style.width) || el.naturalWidth || 0;
      if (w >= 40) {
        el.setAttribute('data-img-editable', '1');
      }
    });
  }

  // ── Activation mode admin ──────────────────────────────
  // ── Langue courante ────────────────────────────────────────
  // La page JP = index.html (ou /NK2/), FR = index-fr.html
  const IS_FR = window.location.pathname.includes('index-fr');
  let currentLang = IS_FR ? 'FR' : 'JP';

  function updateLangBtn() {
    const btn = document.getElementById('admin-lang-btn');
    if (btn) btn.textContent = '🌐 ' + currentLang + ' → ' + (currentLang === 'JP' ? 'FR' : 'JP');
  }

  function switchLang() {
    // Construire la base propre (ex: https://flatjeff.github.io/NK2)
    const base = window.location.origin + window.location.pathname
      .replace(/\/index(-fr)?\.html$/, '')  // retirer index.html ou index-fr.html
      .replace(/\/$/, '');                    // retirer slash final éventuel
    if (currentLang === 'JP') {
      window.location.href = base + '/index-fr.html';
    } else {
      window.location.href = base + '/index.html';
    }
  }

  function enterAdmin() {
    adminMode = true;
    tagEditables();
    document.getElementById('admin-bar').style.display = 'block';
    document.body.classList.add('admin-mode');
    updateLangBtn();
    toast('Mode admin activé — cliquez sur un texte ou une image pour éditer');
  }

  function exitAdmin() {
    adminMode = false;
    document.getElementById('admin-bar').style.display = 'none';
    document.body.classList.remove('admin-mode');
    saveToGitHub();
  }

  // Token décodé automatiquement — pas de popup

  // ── Ctrl+M ─────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      if (!adminMode) { enterAdmin(); } else { exitAdmin(); }
    }
  });

  // ── Clic sur élément éditable ──────────────────────────
  document.addEventListener('click', e => {
    if (!adminMode) return;

    // Image
    const img = e.target.closest('[data-img-editable]');
    if (img) {
      e.preventDefault();
      openImagePopup(img);
      return;
    }

    // Texte
    const txt = e.target.closest('[data-editable]');
    if (txt) {
      e.preventDefault();
      openTextPopup(txt);
    }
  });

  // ── Popup texte ────────────────────────────────────────
  function openTextPopup(el) {
    currentTarget = el;
    currentType   = 'text';
    pendingImageB64 = null;

    // Extraire le texte lisible : on parcourt les noeuds texte et les <br>
    function extractText(node) {
      let out = '';
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) { // texte brut
          out += n.textContent;
        } else if (n.nodeName === 'BR') {
          out += '\n';
        } else if (n.nodeName !== 'IMG') {
          out += extractText(n); // récursif sur spans etc.
        }
      });
      return out;
    }

    const plainText = extractText(el).replace(/\n{3,}/g, '\n\n').trim();

    document.getElementById('admin-popup-title').textContent = 'Éditer le texte';
    document.getElementById('admin-popup-body').innerHTML =
      '<textarea id="admin-textarea"></textarea>';
    document.getElementById('admin-textarea').value = plainText;
    document.getElementById('admin-overlay').classList.add('open');
  }

  // ── Popup image ────────────────────────────────────────
  function openImagePopup(img) {
    currentTarget = img;
    currentType   = 'image';
    pendingImageB64 = null;
    pendingImageName = null;

    // Stocker le chemin original pour la sauvegarde
    if (!img.getAttribute('data-filename')) {
      img.setAttribute('data-filename', img.getAttribute('src'));
    }

    document.getElementById('admin-popup-title').textContent = 'Remplacer l\'image';
    document.getElementById('admin-popup-body').innerHTML = `
      <p style="font:13px Arial,sans-serif;color:#555;margin-bottom:10px;">
        Image actuelle : <code style="font-size:11px">${img.getAttribute('src')}</code>
      </p>
      <img id="admin-img-preview" src="${img.src}">
      <input type="file" id="admin-img-input" accept="image/*">
      <button id="admin-img-btn">📁 Choisir une image</button>
      <div style="display:flex;gap:8px;margin-top:14px;border-top:1px solid #eee;padding-top:14px;">
        <button id="admin-img-duplicate" style="flex:1;background:#2980b9;color:#fff;border:none;border-radius:4px;padding:8px 12px;font:700 12px Arial,sans-serif;cursor:pointer;">🗐 Dupliquer (ajouter en dessous)</button>
        <button id="admin-img-delete" style="flex:1;background:#c0392b;color:#fff;border:none;border-radius:4px;padding:8px 12px;font:700 12px Arial,sans-serif;cursor:pointer;">🗑 Supprimer cette image</button>
      </div>
    `;

    document.getElementById('admin-img-btn').addEventListener('click', () => {
      document.getElementById('admin-img-input').click();
    });

    document.getElementById('admin-img-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      pendingImageName = img.getAttribute('src'); // conserver le même chemin
      const reader = new FileReader();
      reader.onload = ev => {
        pendingImageB64 = ev.target.result; // data:image/xxx;base64,...
        document.getElementById('admin-img-preview').src = pendingImageB64;
      };
      reader.readAsDataURL(file);
    });

    // ── Dupliquer : clone le bloc <p> contenant l'image, l'insère juste après ──
    document.getElementById('admin-img-duplicate').addEventListener('click', () => {
      const block = img.closest('p') || img.closest('td') || img;
      const clone = block.cloneNode(true);
      block.insertAdjacentElement('afterend', clone);
      tagEditables(); // s'assurer que le clone est bien marqué éditable
      toast('✅ Image dupliquée — pense à la remplacer si besoin');
      closePopup();
    });

    // ── Supprimer : retire le bloc <p> contenant l'image ──
    document.getElementById('admin-img-delete').addEventListener('click', () => {
      if (!confirm('Supprimer définitivement cette image de la page ?')) return;
      const block = img.closest('p') || img.closest('td') || img;
      block.remove();
      toast('🗑 Image supprimée');
      closePopup();
    });

    document.getElementById('admin-overlay').classList.add('open');
  }

  // ── Valider ────────────────────────────────────────────
  document.getElementById('admin-validate').addEventListener('click', () => {
    if (currentType === 'text' && currentTarget) {
      const raw = document.getElementById('admin-textarea').value.trim();
      const lines = raw.split('\n');

      function linesToHtml(lines) {
        return lines.map((l, i) => {
          if (l.trim() === '') return '<br>';
          return i < lines.length - 1 ? l + '<br>' : l;
        }).join('');
      }

      // Stratégie robuste : réécrire le innerHTML complet du <p>/<td>
      // en préservant uniquement les images éventuelles.
      // On ne réécrit PAS seulement le span principal car les autres spans
      // (source, badge, etc.) resteraient dans le DOM et doubleraient le contenu.
      const imgs = Array.from(currentTarget.querySelectorAll('img'))
        .map(img => img.cloneNode(true));

      // Récupérer la classe du premier span porteur (pour la conserver)
      const firstSpan = currentTarget.querySelector('span');
      const spanClass = firstSpan ? firstSpan.className : '';

      if (spanClass) {
        // Réécrire avec un seul span qui reprend la classe du premier
        currentTarget.innerHTML =
          '<span class="' + spanClass + '">' + linesToHtml(lines) + '</span>';
      } else {
        currentTarget.innerHTML = linesToHtml(lines);
      }

      // Réattacher les images si besoin
      imgs.forEach(img => currentTarget.appendChild(img));
    }
    if (currentType === 'image' && pendingImageB64 && currentTarget) {
      currentTarget.setAttribute('src', pendingImageB64);
    }
    closePopup();
  });;

  // ── Fermer popup ───────────────────────────────────────
  function closePopup() {
    document.getElementById('admin-overlay').classList.remove('open');
    currentTarget = null;
    currentType   = null;
  }

  document.getElementById('admin-popup-close').addEventListener('click', closePopup);
  document.getElementById('admin-cancel-btn').addEventListener('click', closePopup);
  document.getElementById('admin-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('admin-overlay')) closePopup();
  });

  // ── Sauvegarde GitHub ──────────────────────────────────
  async function getFileSHA(path) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      headers: { 'Authorization': `token ${ghToken}` }
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.sha || null;
  }

  async function pushFile(path, contentB64, message) {
    const sha = await getFileSHA(path);
    const body = { message, content: contentB64, branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return r.ok;
  }

  async function saveToGitHub() {
    toast('⏳ Sauvegarde en cours…', 60000);
    const ts = timestamp();

    try {
      // Même approche que la v1 : outerHTML complet
      let htmlContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

      // Nettoyage avec split/join (pas de regex avec guillemets doubles)
      htmlContent = htmlContent.split(' data-editable="1"').join('');
      htmlContent = htmlContent.split(' data-img-editable="1"').join('');
      htmlContent = htmlContent.split(' admin-mode').join('');
      htmlContent = htmlContent.split('style="display: block;"').join('style="display: none;"');

      // Log pour vérifier que les modifs sont présentes
      console.log('[SAVE] htmlContent length:', htmlContent.length);

      // Encoder en base64 UTF-8
      const encoder = new TextEncoder();
      const bytes = encoder.encode(htmlContent);
      const chunkSize = 32768;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const b64html = btoa(binary);

      const mainFile = IS_FR ? 'index-fr.html' : 'index.html';
      const ok1 = await pushFile(mainFile, b64html, 'Admin save ' + ts);
      console.log('[SAVE] pushFile result:', ok1);

      const backupFile = IS_FR ? 'index-fr-' + ts + '.html' : 'index-' + ts + '.html';
      await pushFile(backupFile, b64html, 'Backup ' + ts);

      if (ok1) {
        toast('✅ Sauvegardé. Attendre 2-3 min puis Ctrl+Shift+R pour recharger.', 8000);
      } else {
        toast('❌ Erreur GitHub', 5000);
      }
    } catch(err) {
      console.error('[SAVE] error:', err.message);
      toast('❌ Erreur : ' + err.message, 5000);
    }
  }
})();
