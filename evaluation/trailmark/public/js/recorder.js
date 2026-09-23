(function () {
    const points = [];
    const pulses = [];
    let watchId = null;

    async function startRecording() {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'denied') {
            showStatus('Location is off for Trailmark. Turn it on in your browser settings to record a route.');
            return false;
        }
        watchId = navigator.geolocation.watchPosition(
            pos => {
                points.push({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    ele: pos.coords.altitude,
                    t: pos.timestamp,
                });
            },
            err => showStatus(`Location error: ${err.message}`),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
        return true;
    }

    async function pairStrap() {
        const strap = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });
        const gatt = await strap.gatt.connect();
        const service = await gatt.getPrimaryService(0x180d);
        const channel = await service.getCharacteristic(0x2a37);
        await channel.startNotifications();
        channel.addEventListener('characteristicvaluechanged', event => {
            const data = event.target.value;
            const bpm = data.getUint8(0) & 0x1 ? data.getUint16(1, true) : data.getUint8(1);
            pulses.push({ bpm, t: Date.now() });
        });
        return strap.name;
    }

    function stopRecording() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        return { points: points.splice(0), pulses: pulses.splice(0) };
    }

    function showStatus(message) {
        const el = document.getElementById('recorder-status');
        if (el) {
            el.textContent = message;
        }
    }

    window.trailmarkRecorder = { startRecording, pairStrap, stopRecording };
})();
