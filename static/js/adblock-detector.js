(function() {
  window.SolarisAdblock = {
    detected: false,
    checked: false,

    async check() {
      if (this.checked) return this.detected;
      this.checked = true;

      const results = await Promise.all([
        this._checkBaitFile(),
        this._checkBaitElement()
      ]);

      this.detected = results.every(r => r === true);
      return this.detected;
    },

    async _checkBaitFile() {
      try {
        const res = await fetch(
          '/static/js/ads.js?v=' + Date.now(),
          { cache: 'no-store' }
        );
        if (!res.ok) return true;
        const text = await res.text();
        return !text.includes('adsLoaded');
      } catch {
        return true;
      }
    },

    async _checkBaitElement() {
      return new Promise(resolve => {
        const bait = document.createElement('div');
        bait.setAttribute('class',
          'pub_300x250 pub_300x250m ad-unit adsbygoogle');
        bait.setAttribute('style',
          'width:1px;height:1px;position:absolute;left:-9999px;');
        bait.innerHTML = '&nbsp;';
        document.body.appendChild(bait);

        setTimeout(() => {
          const blocked = (
            bait.offsetHeight === 0 ||
            bait.offsetWidth === 0 ||
            window.getComputedStyle(bait).display === 'none' ||
            window.getComputedStyle(bait).visibility === 'hidden'
          );
          document.body.removeChild(bait);
          resolve(blocked);
        }, 200);
      });
    }
  };
})();
