import { FEATURES } from "../../config/features";
import { HiArrowRight, HiExclamationTriangle, HiShoppingCart } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";
import { canteens, services } from "./data";

function Services({ go, storeCart, printFile, openModal }) {
  return (
    <section className="page-section services-page">
      <PageHeader
        kicker="CAMPUS SERVICES"
        title="Get things done."
        text="Everyday services, without the queue."
      />

      <div className="service-grid">
        {services.map((service) => (
          <button
            className="service-card"
            key={service.id}
            onClick={() => go(service.id)}
          >
            <span className="service-icon">{service.icon}</span>
            <div>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </div>
            <span className="service-arrow">
              {service.action} <HiArrowRight />
            </span>
          </button>
        ))}
      </div>

      <div className="service-dashboard">
        <div className="service-dash-card">
          <span className="section-kicker">PRINT HUB</span>
          <h2>Upload. Pay. Pick up.</h2>
          <p>
            {printFile
              ? `Selected: ${printFile}`
              : "Send your project report before you reach the print shop."}
          </p>

          <div className="steps">
            <span><b>1</b> Upload</span>
            <span><b>2</b> Configure</span>
            <span><b>3</b> Pay</span>
            <span><b>4</b> QR Pickup</span>
          </div>

          <button onClick={() => go("print")}>
            Open Print Hub <HiArrowRight />
          </button>
        </div>

        {FEATURES.food && (
          <div className="service-dash-card">
            <span className="section-kicker">FOOD HUB</span>
            <h2>Four canteens. One checkout.</h2>
            <p>
              Udupi, Tango, Munch and Nescafe are now searchable from the same
              campus interface.
            </p>

            <div className="mini-canteens">
              {canteens.map((canteen) => (
                <div key={canteen.id}>
                  <b>{canteen.name}</b>
                  <small>{canteen.eta} · {canteen.status}</small>
                </div>
              ))}
            </div>

            <button onClick={() => go("food")}>
              Open Food Hub <HiArrowRight />
            </button>
          </div>
        )}
      </div>

      <div className="service-footer-grid">
        <MiniService
          icon={<HiShoppingCart />}
          title="Stationery"
          text={`${storeCart.length} items in cart`}
          onClick={() => go("store")}
        />
        <MiniService
          icon={<HiExclamationTriangle />}
          title="Emergency"
          text="Campus SOS"
          onClick={() => openModal?.("sos")}
        />
      </div>
    </section>
  );
}

function MiniService({ icon, title, text, onClick }) {
  return (
    <button className="mini-service" onClick={onClick}>
      <span>{icon}</span>
      <div>
        <b>{title}</b>
        <small>{text}</small>
      </div>
      <HiArrowRight />
    </button>
  );
}

export { MiniService, Services };
