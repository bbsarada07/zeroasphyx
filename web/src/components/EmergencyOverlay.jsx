import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren, VolumeX } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { post } from '../lib/api';
import { audioBlocked, speak, startSiren, stopSpeech, unlockAudio } from '../lib/siren';
import { GAS, ago, fmtTime, manholeOf, workerName } from '../lib/format';

const MESSAGES = [
  ['en-IN', 'EN', 'DO NOT ENTER TO RESCUE. Call 112 or Fire Service 101.'],
  ['hi-IN', 'HI', 'बचाने के लिए अंदर मत जाइए। 112 या 101 पर कॉल करें।'],
  ['te-IN', 'TE', 'రక్షించడానికి లోపలికి వెళ్లవద్దు. 112 లేదా 101 కు కాల్ చేయండి.'],
];

const CAUSE = { MAN_DOWN: 'MAN DOWN', SOS: 'SOS PRESSED' };

export default function EmergencyOverlay() {
  const { live, refs } = useLive();
  const now = useNow(1000);
  const incidents = live?.incidents || [];
  const incident = incidents[0];
  const [blocked, setBlocked] = useState(false);
  const [acking, setAcking] = useState(false);

  // Looping siren while any incident is unacknowledged.
  useEffect(() => {
    if (!incident) return undefined;
    let stop = startSiren();
    setBlocked(audioBlocked());
    // If the browser blocked audio, start as soon as the user clicks anywhere.
    const retry = () => {
      unlockAudio();
      stop();
      stop = startSiren();
      setBlocked(audioBlocked());
    };
    window.addEventListener('pointerdown', retry, { once: true });
    return () => {
      window.removeEventListener('pointerdown', retry);
      stop();
    };
  }, [incident?.id]);

  // Speak the warning once per incident (Hindi/Telugu only if the device has those voices).
  useEffect(() => {
    if (!incident) return undefined;
    speak(MESSAGES.map(([lang, , text]) => [lang, text]));
    return () => stopSpeech();
  }, [incident?.id]);

  if (!incident) return null;
  const manhole = manholeOf(refs, incident.manholeId);
  const lr = incident.lastReadings;

  const acknowledge = async () => {
    setAcking(true);
    try { await post(`/incidents/${incident.id}/ack`); } finally { setAcking(false); }
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="za-emergency-title" className="za-flash fixed inset-0 z-[100] overflow-y-auto text-white print:hidden">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-4">
          <Siren className="h-16 w-16 shrink-0 sm:h-20 sm:w-20" aria-hidden />
          <div>
            <p className="text-lg font-bold uppercase tracking-[0.2em] text-red-100">Emergency · {ago(now - Date.parse(incident.createdAt))}</p>
            <h1 id="za-emergency-title" className="text-5xl font-black leading-none sm:text-7xl">{CAUSE[incident.cause] || incident.cause}</h1>
          </div>
          {incidents.length > 1 && (
            <span className="ml-auto rounded-full bg-white px-4 py-2 text-lg font-black text-red-800">+{incidents.length - 1} more</span>
          )}
        </div>

        <div className="space-y-3 rounded-3xl border-4 border-white bg-red-950/60 p-5 sm:p-7">
          {MESSAGES.map(([lang, tag, text]) => (
            <p key={lang} lang={lang.slice(0, 2)} className="flex items-baseline gap-4 text-2xl font-black leading-snug sm:text-4xl">
              <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-base font-black text-red-800 sm:text-lg">{tag}</span>
              <span>{text}</span>
            </p>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-black/30 p-5">
            <dl className="grid grid-cols-2 gap-4 text-lg">
              <div><dt className="text-sm font-bold uppercase text-red-200">Worker</dt><dd className="text-2xl font-black">{workerName(refs, incident.workerId)}</dd></div>
              <div><dt className="text-sm font-bold uppercase text-red-200">Manhole</dt><dd className="text-2xl font-black">{incident.manholeId}</dd></div>
              <div className="col-span-2"><dt className="text-sm font-bold uppercase text-red-200">Location</dt><dd className="font-semibold">{manhole?.address || '—'}</dd></div>
              <div><dt className="text-sm font-bold uppercase text-red-200">Permit</dt><dd className="font-mono font-bold">{incident.permitId}</dd></div>
              <div><dt className="text-sm font-bold uppercase text-red-200">Raised</dt><dd className="font-semibold">{fmtTime(incident.createdAt)} · {incident.source}</dd></div>
            </dl>
          </div>
          <div className="rounded-2xl bg-black/30 p-5">
            <p className="mb-3 text-sm font-bold uppercase text-red-200">Last beacon readings {lr ? `(${fmtTime(lr.ts)})` : ''}</p>
            {lr ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {GAS.map((g) => (
                  <div key={g.key} className="rounded-xl bg-white/10 p-3 text-center">
                    <div className="text-sm font-bold">{g.label}</div>
                    <div className="text-3xl font-black">{g.fmt(lr[g.key])}</div>
                    <div className="text-xs font-semibold text-red-100">{g.unit}</div>
                  </div>
                ))}
                <div className="rounded-xl bg-white/10 p-3 text-center">
                  <div className="text-sm font-bold">Motion</div>
                  <div className="text-xl font-black">{lr.moving ? 'Moving' : 'STILL'}</div>
                </div>
              </div>
            ) : (
              <p className="text-lg font-semibold">No beacon readings received.</p>
            )}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={acknowledge}
            disabled={acking}
            className="rounded-2xl bg-white px-10 py-5 text-2xl font-black text-red-800 shadow-xl hover:bg-red-50 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            ACKNOWLEDGE
          </button>
          <Link to={`/report/${incident.id}`} onClick={acknowledge} className="text-lg font-bold underline underline-offset-4">
            Open evidence report
          </Link>
          {blocked && (
            <span className="inline-flex items-center gap-2 rounded-xl bg-black/30 px-3 py-2 text-base font-semibold">
              <VolumeX className="h-5 w-5" aria-hidden /> Browser blocked the siren: click anywhere to sound it
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
