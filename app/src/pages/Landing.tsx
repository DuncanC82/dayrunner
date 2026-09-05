import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="land">
      <nav className="nav">
        <div className="brand">DayRunner</div>
        <div className="stack"><Link className="btn ghost" to="/signin">Sign in</Link><Link className="btn" to="/signup">Start free</Link></div>
      </nav>
      <header className="hero">
        <div className="eyebrow">Operations for tour, shuttle and rental operators</div>
        <h1>Your booking system knows who's coming tomorrow. It has no idea how you'll get them there.</h1>
        <p>DayRunner plugs into Rezdy, FareHarbor or Rental Car Manager and runs the day: allocates drivers, guides and vehicles against real constraints, drafts every pickup message, lists what to confirm with suppliers, and flags the three things a human still has to decide. Nothing sends until you approve it.</p>
        <div className="stack"><Link className="btn" to="/signup">Run tomorrow in 5 minutes</Link><a className="btn ghost" href="#how">See how it works</a></div>
      </header>

      <section>
        <h2>The glue you're paying for today</h2>
        <p className="muted" style={{ maxWidth: "62ch" }}>Every small operator runs the day on a spreadsheet, a WhatsApp group and a person. The booking platform owns the inventory and nothing else, so everything around the booking gets stitched together by hand.</p>
        <div className="evidence">
          <div className="ev"><q>Nine systems and a developer to run one booking funnel: RCM, Respond.io, Zapier, Google Sheets, Woodpecker, Stripe, SendGrid and custom code.</q><span className="who">NZ campervan rental operator, 2026</span></div>
          <div className="ev"><q>Manage bookings and availability through FareHarbor, Viator and GetYourGuide. Help prepare daily schedules and information for guides and drivers.</q><span className="who">Job ad, $60–70k operations administrator, Nelson</span></div>
          <div className="ev"><q>Creating daily manifests for pickups and ensuring all tours are ready to go for the next day.</q><span className="who">Job ad, part-time logistics, Te Anau</span></div>
          <div className="ev"><q>Monitor the office phone for calls from customers, hotels and guides when issues arise.</q><span className="who">Job ad, reservations administrator, Canterbury</span></div>
        </div>
      </section>

      <section id="how">
        <h2>How a day runs</h2>
        <div className="steps">
          <div><b>1 · Pull tomorrow</b>Bookings and departures arrive from your booking system by webhook, or you drop in a CSV export.</div>
          <div><b>2 · Allocate</b>Drivers, guides and vehicles matched to licence class, seats, hours, skills and availability. Pickups sequenced in your stop order.</div>
          <div><b>3 · Draft</b>Every guest message in your voice. Every supplier confirmation with its deadline. Every exception with options.</div>
          <div><b>4 · Approve and send</b>You read it, fix what you want, approve. WhatsApp first, SMS and email fallback, or copy and send yourself.</div>
        </div>
      </section>

      <section>
        <h2>Works with</h2>
        <div className="stack"><span>Rezdy</span><span>FareHarbor</span><span>Rental Car Manager</span><span>CSV from anything</span><span>WhatsApp Business</span><span>Twilio SMS</span><span>Email</span></div>
        <p className="muted small">Bókun, Checkfront and Peek on request.</p>
      </section>

      <section>
        <h2>Pricing</h2>
        <div className="pricing">
          <div className="price"><div className="eyebrow">Solo</div><div className="amt">$149<span className="small muted">/mo</span></div><p>One depot, up to 5 departures a day. Approval queue, all connectors, manual sending.</p></div>
          <div className="price lead"><div className="eyebrow">Team</div><div className="amt">$299<span className="small muted">/mo</span></div><p>Unlimited departures, WhatsApp sending included up to 2,000 messages, guide run sheets, incident log.</p></div>
          <div className="price"><div className="eyebrow">Founding partner</div><div className="amt">$0<span className="small muted"> to 31 Dec 2026</span></div><p>Five operators. Weekly feedback call in exchange. You shape the product.</p></div>
        </div>
        <div className="bar"><Link className="btn" to="/signup">Apply as a founding partner</Link></div>
      </section>

      <footer className="muted small" style={{ marginTop: 60, borderTop: "1px solid var(--line)", paddingTop: 12 }}>DayRunner · Queenstown, New Zealand · Built by operators who got tired of the spreadsheet.</footer>
    </div>
  );
}
