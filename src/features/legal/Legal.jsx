import { HiArrowLeft } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

function LegalContent() {
  return (
    <div className="legal-content">
      <h2>Privacy Policy</h2>
      <p><em>Last updated 24 August 2026.</em></p>

      <h3>What we collect</h3>
      <p>
        Account info (name, USN, course, year, college email), anything you
        add to your profile (bio, skills, achievements, LinkedIn/GitHub
        links), and activity you generate using CampusOS: food orders,
        event registrations, club memberships, marketplace listings, lost
        &amp; found reports, facilities tickets, resource bookings, print
        jobs, and posts/comments/likes. If you submit your student ID for
        verification, that photo is stored privately and reviewed by campus
        admin staff only.
      </p>

      <h3>How it&apos;s used</h3>
      <p>
        To run the features you use — placing orders, registering for
        events, connecting you with classmates in your branch/year, routing
        tickets to facilities staff, and processing payments through
        Razorpay for anything you pay for. Your name/branch/year/skills are
        visible to other verified students on this campus (see Connect);
        your email and phone number are never shown to other students.
      </p>

      <h3>Who it&apos;s shared with</h3>
      <p>
        Never sold. Vendors (canteens, the print shop) see the order/job
        details needed to fulfill what you ordered. Campus admins and
        facilities staff can see what&apos;s needed to moderate content, review
        reports, and resolve tickets — every privileged action is logged.
        Payments are processed by Razorpay; we don&apos;t store your card
        details.
      </p>

      <h3>Your choices &amp; data principal rights</h3>
      <p>
        You can edit or remove most profile info yourself at any time. You
        can set your profile to be hidden from the classmate directory in
        Edit Profile. From your profile page you can <strong>download a
        copy of your data</strong> in-app at any time (a machine-readable
        export of your orders, registrations, memberships, listings,
        tickets, bookings, and similar activity), and <strong>request
        account deletion</strong> in-app — a campus admin reviews and
        actions every deletion request rather than it happening instantly,
        since your data intersects other people&apos;s records (e.g. an
        order a vendor fulfilled, or an event you&apos;re on the roster
        for). You can cancel a pending deletion request yourself at any
        time before it&apos;s actioned.
      </p>
      <p>
        If you&apos;re a data principal under India&apos;s Digital Personal
        Data Protection Act, 2023 and the above doesn&apos;t cover what
        you&apos;re asking for (correction of inaccurate data, withdrawing
        consent, or a grievance about how your data was handled), contact
        your campus admin — for this deployment, that&apos;s the point of
        contact standing in for a formally designated Grievance Officer
        until CampusOS is run by an organization that appoints one. We aim
        to acknowledge grievances within a reasonable time.
      </p>
      <p style={{ opacity: 0.75, fontSize: "0.9em" }}>
        This policy is written in plain language for a campus deployment,
        not drafted or reviewed by a lawyer — treat it as a good-faith
        starting point, not a substitute for a real compliance review
        before onboarding an actual college&apos;s students.
      </p>

      <h2>Terms of Service</h2>

      <h3>Your account</h3>
      <p>
        One account per student, tied to a valid USN or college email.
        You&apos;re responsible for what happens under your account — don&apos;t
        share your password. Accounts can be suspended for violating these
        terms (spam, harassment, fraudulent orders/listings, impersonation,
        or abuse of any campus service); a suspended account cannot place
        orders, post, register for events, book resources, or use any
        other feature until reactivated by a campus admin.
      </p>
      <p>
        By creating an account, you confirm you are 18 years of age or
        older. CampusOS is built for an enrolled college student
        population; see <code>docs/MINORS_POLICY_DECISION.md</code> in the
        project repository for how this is handled.
      </p>

      <h3>Payments &amp; orders</h3>
      <p>
        Prices shown at checkout are final at the time of payment. Refunds
        for cancelled or failed orders are processed back to your original
        payment method — contact the vendor or a campus admin if a refund
        doesn&apos;t appear within a reasonable time. Vendors are responsible
        for the accuracy of their own menu/pricing.
      </p>

      <h3>Marketplace &amp; lost &amp; found</h3>
      <p>
        Listings and reports must be accurate. CampusOS is a venue
        connecting students directly — we aren&apos;t a party to any sale and
        don&apos;t guarantee the condition or existence of listed items.
      </p>

      <h3>Content you post</h3>
      <p>
        Don&apos;t post anything illegal, harassing, or that violates someone
        else&apos;s privacy or rights. Reported content is reviewed by campus
        moderators, who can hide or remove it and take action on the
        account that posted it.
      </p>

      <h3>Changes</h3>
      <p>
        We may update these terms as CampusOS adds features; continuing to
        use the app after a change means you accept the update.
      </p>
    </div>
  );
}

function LegalPage({ go }) {
  return (
    <section className="page-section">
      <PageHeader kicker="LEGAL" title="Privacy & Terms" text="How CampusOS handles your data, and what's expected of you." />
      <div className="profile-box profile-wide-box">
        <LegalContent />
      </div>
      {go && (
        <button className="ghost" style={{ marginTop: 16 }} onClick={() => go("profile")}>
          <HiArrowLeft /> Back to profile
        </button>
      )}
    </section>
  );
}

export { LegalContent, LegalPage };
