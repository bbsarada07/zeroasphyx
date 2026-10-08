import { Clock, Siren, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useLive } from '../lib/live';
import { post } from '../lib/api';

const STYLE = {
  EVACUATE: ['za-flash text-white', Siren, 'EVACUATE'],
  RETEST_REQUIRED: ['bg-amber-400 text-slate-950', Clock, 'RE-TEST REQUIRED'],
  SIGNAL_LOST: ['bg-amber-400 text-slate-950', WifiOff, 'SIGNAL LOST'],
  UNLINKED: ['bg-slate-700 text-white', TriangleAlert, 'UNLINKED ALERT'],
};

export default function AlertBanners() {
  const { live } = useLive();
  const alerts = live?.alerts || [];
  if (!alerts.length) return null;
  return (
    <div className="print:hidden" aria-live="assertive">
      {alerts.map((a) => {
        const [cls, Icon, title] = STYLE[a.type] || STYLE.UNLINKED;
        const big = a.type === 'EVACUATE';
        return (
          <div key={a.id} role="alert" className={cls}>
            <div className={`mx-auto flex max-w-[1600px] items-center gap-4 px-4 ${big ? 'py-4' : 'py-2.5'}`}>
              <Icon className={big ? 'h-10 w-10 shrink-0' : 'h-6 w-6 shrink-0'} aria-hidden />
              <div className="min-w-0 flex-1">
                <span className={`mr-3 font-black tracking-wide ${big ? 'text-3xl' : 'text-lg'}`}>{title}</span>
                <span className={`font-semibold ${big ? 'text-xl' : 'text-base'}`}>{a.message}</span>
              </div>
              <button
                type="button"
                onClick={() => post(`/alerts/${a.id}/dismiss`)}
                className="rounded-lg p-2 hover:bg-black/15"
                aria-label={`Dismiss ${title} alert`}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
