import React, { Suspense, lazy, useState } from "react";
import { LoadingState } from "../../components/ui/States";
import { createCampusServiceRequest, createResourceBooking, getMyPrintJobs } from "../../services/mvpService";
import { HiAcademicCap, HiArrowRight, HiBoltSlash, HiBuildingOffice2, HiCalendarDays, HiComputerDesktop, HiCreditCard, HiDocumentArrowUp, HiExclamationTriangle, HiLifebuoy, HiLightBulb, HiMagnifyingGlassCircle, HiPhone, HiPrinter, HiQrCode, HiShoppingCart, HiWifi, HiWrenchScrewdriver } from "react-icons/hi2";
import { ModalShell, PageHeader } from "../../components/ui/Shell";
import { LostService } from "../lostfound/LostFound";
import { PrintJobsPanel } from "../print/PrintJobsPanel";

const Marketplace = lazy(() => import("../marketplace/Marketplace"));

const AcademicHub = lazy(() => import("../academics/AcademicHub"));

const EmergencyDirectory = lazy(() => import("../emergency/EmergencyDirectory"));

const SupportService = lazy(() => import("../support/SupportCenter"));

const serviceDetailData = {
  print: {
    kicker: "PRINT HUB",
    title: "Print & Documents",
    text: "Upload, configure, pay and collect without waiting in line.",
    icon: <HiPrinter />,
  },
  issues: {
    kicker: "FACILITIES",
    title: "Report an Issue",
    text: "Send a campus issue to the right team and track resolution.",
    icon: <HiWrenchScrewdriver />,
  },
  booking: {
    kicker: "RESOURCE BOOKING",
    title: "Book Campus Resources",
    text: "Reserve halls, labs, equipment and sports facilities.",
    icon: <HiBuildingOffice2 />,
  },
  lost: {
    kicker: "LOST & FOUND",
    title: "Campus Lost & Found",
    text: "Report, search and claim items around campus.",
    icon: <HiMagnifyingGlassCircle />,
  },
  market: {
    kicker: "MARKETPLACE",
    title: "Campus Marketplace",
    text: "Buy and sell permitted items inside the verified campus network.",
    icon: <HiShoppingCart />,
  },
  academics: {
    kicker: "ACADEMICS",
    title: "Academic Announcements",
    text: "Department/faculty announcements, assignments, timetable and academic calendar.",
    icon: <HiAcademicCap />,
  },
  emergencydirectory: {
    kicker: "EMERGENCY DIRECTORY",
    title: "Campus Emergency Contacts",
    text: "Verified security, medical, facilities, transport and hostel numbers — who to call, and whether they're open right now.",
    icon: <HiPhone />,
  },
  support: {
    kicker: "SUPPORT",
    title: "Get Help",
    text: "Account, payment or technical problems that aren't a facilities issue — talk to campus staff directly.",
    icon: <HiLifebuoy />,
  },
};

function ServiceDetail({ serviceId, notify, go, openModal, openLogin, authUser, profile, campusId, resources, bookings, serviceRequests, printJobs, lostItems, lostItemsLoaded, marketListings, onBookingsChange, onRequestsChange, onLostItemsChange, onMarketListingsChange, onPrintJobsChange, onOpenConversation, can, isAdmin }) {
  const data = serviceDetailData[serviceId];

  return (
    <section className="page-section service-detail-page">
      <PageHeader
        kicker={data.kicker}
        title={data.title}
        text={data.text}
        action={
          <button className="ghost" onClick={() => go("services")}>
            Back to services
          </button>
        }
      />

      <div className="service-detail-hero">
        <div className="service-detail-icon">{data.icon}</div>
        <div>
          <span className="section-kicker">CAMPUS WORKFLOW</span>
          <h2>{data.title}</h2>
          <p>{data.text}</p>
        </div>
      </div>

      {serviceId === "print" && (
        <>
          <div className="service-detail-grid">
            <WorkflowCard
              icon={<HiDocumentArrowUp />}
              title="1. Upload document"
              text="PDF only, up to 25MB."
              button="Upload"
              onClick={() => openModal("print")}
            />
            <WorkflowCard
              icon={<HiCreditCard />}
              title="2. Configure & pay"
              text="Colour, copies, binding, duplex and paper size."
              button="Configure"
              onClick={() => openModal("print")}
            />
            <WorkflowCard
              icon={<HiQrCode />}
              title="3. QR pickup"
              text="Collect when the shop marks it ready."
              button="View my jobs"
              onClick={() => document.getElementById("print-jobs-panel")?.scrollIntoView({ behavior: "smooth" })}
            />
          </div>
          <div id="print-jobs-panel">
            <PrintJobsPanel
              jobs={printJobs}
              notify={notify}
              onChange={() => authUser && getMyPrintJobs(authUser.id).then(onPrintJobsChange).catch(() => {})}
            />
          </div>
        </>
      )}

      {serviceId === "issues" && (
        <IssueService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} requests={serviceRequests} onChange={onRequestsChange} />
      )}

      {serviceId === "booking" && (
        <BookingService notify={notify} authUser={authUser} openLogin={openLogin} resources={resources} bookings={bookings} onChange={onBookingsChange} />
      )}

      {serviceId === "lost" && (
        <LostService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} items={lostItems} loaded={lostItemsLoaded} onChange={onLostItemsChange} />
      )}

      {serviceId === "market" && (
        <Suspense fallback={<LoadingState label="Loading marketplace…" />}>
          <Marketplace notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} listings={marketListings} onChange={onMarketListingsChange} onOpenConversation={onOpenConversation} />
        </Suspense>
      )}

      {serviceId === "academics" && (
        <Suspense fallback={<LoadingState label="Loading academics…" />}>
          <AcademicHub profile={profile} notify={notify} can={can} isAdmin={isAdmin} />
        </Suspense>
      )}

      {serviceId === "emergencydirectory" && (
        <Suspense fallback={<LoadingState label="Loading emergency directory…" />}>
          <EmergencyDirectory />
        </Suspense>
      )}

      {serviceId === "support" && (
        <Suspense fallback={<LoadingState label="Loading support…" />}>
          <SupportService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} />
        </Suspense>
      )}
    </section>
  );
}

function WorkflowCard({ icon, title, text, button, onClick }) {
  return (
    <article className="workflow-card">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button onClick={onClick}>
        {button} <HiArrowRight />
      </button>
    </article>
  );
}

function IssueService({ notify, authUser, openLogin, campusId, requests = [], onChange }) {
  /* eslint-disable react/jsx-key -- [title, icon] tuples; the key is
     supplied at the categories.map() call site below. */
  const categories = [
    ["Wi-Fi", <HiWifi />],
    ["Electrical", <HiLightBulb />],
    ["AC", <HiBoltSlash />],
    ["Furniture", <HiBuildingOffice2 />],
    ["Lab Equipment", <HiComputerDesktop />],
    ["Other", <HiExclamationTriangle />],
  ];
  /* eslint-enable react/jsx-key */

  return (
    <div className="service-detail-grid">
      {categories.map(([title, icon]) => (
        <WorkflowCard
          key={title}
          icon={icon}
          title={title}
          text={`Report a ${title.toLowerCase()} issue.`}
          button="Report"
          onClick={async () => {
            if (!authUser) {
              openLogin?.();
              notify("Sign in to report an issue");
              return;
            }
            try { const request = await createCampusServiceRequest({ userId: authUser.id, campusId, serviceName: "Report an Issue", title: `${title} issue`, details: { category: title } }); onChange?.((items) => [request, ...items]); notify(`Ticket created · ${request.id.slice(0, 8)}`); }
            catch (error) { notify(error.message || "Could not create ticket"); }
          }}
        />
      ))}
      {requests.map((request) => <article className="resource-row" key={request.id}><div className="resource-icon"><HiWrenchScrewdriver /></div><div><b>{request.title}</b><small>Ticket {request.id.slice(0, 8)}</small></div><strong>{request.status}</strong></article>)}
    </div>
  );
}

function BookingService({ notify, authUser, openLogin, resources: dbResources = [], bookings = [], onChange }) {
  const [selected, setSelected] = useState(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const resources = dbResources.length ? dbResources.map((item) => [item.name, "Available", item.locations?.name || item.resource_type, item.id]) : [
    ["Innovation Lab", "Available", "2nd Floor"],
    ["Seminar Hall 2", "Available", "Main Block"],
    ["Robotics Lab", "Available", "Block D"],
    ["Sports Court", "Booked", "Ground"],
  ];

  return (
    <div className="resource-list">
      {resources.map(([name, status, location, resourceId]) => (
        <article className="resource-row" key={resourceId || name}>
          <div className="resource-icon"><HiBuildingOffice2 /></div>
          <div>
            <b>{name}</b>
            <small>{location} · {status}</small>
          </div>
          <button
            onClick={() => resourceId ? setSelected({ id: resourceId, name }) : notify("No bookable resources are configured")}
          >
            Book <HiArrowRight />
          </button>
        </article>
      ))}
      {selected && <ModalShell kicker="RESOURCE BOOKING" title={selected.name} onClose={() => setSelected(null)}><label>Start<input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label><label>End<input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label><button className="primary wide" onClick={async () => { if (!authUser) { openLogin?.(); notify("Sign in to book a resource"); return; } try { const booking = await createResourceBooking({ userId: authUser.id, resourceId: selected.id, startTime, endTime }); onChange?.((items) => [...items, booking]); setSelected(null); notify("Booking requested"); } catch (error) { notify(error.message || "Could not create booking"); } }}>Request booking</button></ModalShell>}
      {bookings.map((booking) => <article className="resource-row" key={booking.id}><div className="resource-icon"><HiCalendarDays /></div><div><b>{booking.resources?.name}</b><small>{new Date(booking.start_time).toLocaleString()}</small></div><strong>{booking.status}</strong></article>)}
    </div>
  );
}

export { AcademicHub, BookingService, EmergencyDirectory, IssueService, Marketplace, ServiceDetail, SupportService, WorkflowCard, serviceDetailData };
