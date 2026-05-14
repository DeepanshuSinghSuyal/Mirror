/* ================================================
   MIRROR Bot — Weather Module
   Uses Open-Meteo API (free, no key required)
   ================================================ */
const MirrorWeather = (() => {
  const elTemp = document.getElementById('weather-temp');
  const elCond = document.getElementById('weather-condition');
  const elHum  = document.getElementById('weather-humidity');
  const elLoc  = document.getElementById('weather-location');
  const elIcon = document.getElementById('weather-icon');

  const INTERVAL = 600000; // 10 min refresh
  let _iv = null;

  // WMO weather code mapping
  const WMO = {
    0:['Clear sky','☀️'], 1:['Mainly clear','🌤️'], 2:['Partly cloudy','⛅'],
    3:['Overcast','☁️'], 45:['Fog','🌫️'], 48:['Rime fog','🌫️'],
    51:['Light drizzle','🌦️'], 53:['Drizzle','🌦️'], 55:['Dense drizzle','🌧️'],
    61:['Slight rain','🌧️'], 63:['Moderate rain','🌧️'], 65:['Heavy rain','🌧️'],
    66:['Freezing rain','🌨️'], 67:['Heavy freezing rain','🌨️'],
    71:['Slight snow','❄️'], 73:['Moderate snow','❄️'], 75:['Heavy snow','❄️'],
    77:['Snow grains','❄️'], 80:['Slight showers','🌦️'], 81:['Mod showers','🌧️'],
    82:['Violent showers','⛈️'], 85:['Snow showers','🌨️'], 86:['Heavy snow showers','🌨️'],
    95:['Thunderstorm','⛈️'], 96:['Thunderstorm w/ hail','⛈️'], 99:['Severe thunderstorm','⛈️']
  };

  function decodeWMO(code) {
    return WMO[code] || ['Unknown', '🌡️'];
  }

  async function getLocation() {
    // Try browser geolocation first
    return new Promise((resolve) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve({ lat: 28.6139, lon: 77.2090 }), // Fallback: New Delhi
          { timeout: 5000 }
        );
      } else {
        resolve({ lat: 28.6139, lon: 77.2090 });
      }
    });
  }

  async function fetchLocationName(lat, lon) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`);
      const d = await res.json();
      return d.address?.city || d.address?.town || d.address?.state || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  async function fetchWeather() {
    try {
      const loc = await getLocation();
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
      const res = await fetch(url);
      const d = await res.json();
      const cur = d.current;
      const [condText, condIcon] = decodeWMO(cur.weather_code);
      const locName = await fetchLocationName(loc.lat, loc.lon);

      elTemp.textContent = Math.round(cur.temperature_2m);
      elCond.textContent = condText;
      elHum.textContent = cur.relative_humidity_2m + '%';
      elLoc.textContent = locName;
      elIcon.textContent = condIcon;
    } catch (e) {
      console.warn('[Weather] Fetch failed:', e);
      elTemp.textContent = '--';
      elCond.textContent = 'Unavailable';
    }
  }

  function getWeatherSummary() {
    return `${elTemp.textContent}°C, ${elCond.textContent}, Humidity: ${elHum.textContent}, Location: ${elLoc.textContent}`;
  }

  function start() {
    fetchWeather();
    _iv = setInterval(fetchWeather, INTERVAL);
  }

  function stop() { if (_iv) clearInterval(_iv); }

  return { start, stop, fetchWeather, getWeatherSummary };
})();
