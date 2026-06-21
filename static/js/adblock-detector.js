(function() {
  window.SolarisAdblock = {
    detected: false,
    checked: false,

    async check() {
      if (this.checked) return this.detected;
      this.checked = true;

      const results = await Promise.all([
        this._checkBaitFile(),
        this._checkBaitElement(),
        this._checkBaitFetch(),
        this._checkBraveBrowser()
      ]);

      this.detected = results.some(r => r === true);
      return this.detected;
    },

    async _checkBaitFile() {
      try {
        const res = await fetch('/static/js/ads.js?v=' + Date.now(), {
          cache: 'no-store'
        });
        if (!res.ok) return true;
        const text = await res.text();
        return !text.includes('adsLoaded');
      } catch {
        return true;
      }
    },

    async _checkBaitElement() {
      return new Promise(resolve => {
        const el = document.createElement('div');
        el.className = 'pub_300x250 pub_300x250m ad-unit adsbygoogle';
        el.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;';
        el.innerHTML = '&nbsp;';
        document.body.appendChild(el);

        setTimeout(() => {
          const style = window.getComputedStyle(el);
          const blocked = (
            el.offsetHeight === 0 ||
            el.offsetWidth === 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          );
          document.body.removeChild(el);
          resolve(blocked);
        }, 100);
      });
    },

    async _checkBaitFetch() {
      const urls = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://static.ads-twitter.com/uwt.js',
        'https://connect.facebook.net/en_US/fbevents.js'
      ];

      for (const url of urls) {
        try {
          await fetch(url, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-store'
          });
        } catch {
          return true;
        }
      }
      return false;
    },

    _checkBraveBrowser() {
      return new Promise(resolve => {
        if (navigator.brave) {
          navigator.brave.isBrave()
            .then(isBrave => resolve(isBrave))
            .catch(() => resolve(false));
        } else {
          resolve(false);
        }
      });
    }
  };
})();
