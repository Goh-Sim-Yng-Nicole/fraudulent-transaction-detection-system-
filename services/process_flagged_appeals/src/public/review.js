const tableBody = document.getElementById("reviewTable");
const statusText = document.getElementById("status");

async function loadReviews() {
  try {
    statusText.textContent = "Loading...";
    const res = await fetch("/api/v1/reviews/pending");
    const json = await res.json();

    if (!json.success) {
      throw new Error("API returned failure");
    }

    const reviews = json.data.pendingReviews;
    tableBody.innerHTML = "";

    if (!reviews || reviews.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7">No pending reviews</td>
        </tr>
      `;
      statusText.textContent = "";
      return;
    }

    reviews.forEach(tx => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${tx.id}</td>
        <td>${tx.userId ?? "-"}</td>
        <td>$${tx.amount ?? "-"}</td>
        <td>${tx.score ?? "-"}</td>
        <td>${tx.reason ?? "-"}</td>
        <td class="status-pending">pending</td>
        <td>
          <button class="approve-btn" data-id="${tx.id}">Approve</button>
          <button class="reject-btn" data-id="${tx.id}">Reject</button>
        </td>
      `;

      tableBody.appendChild(row);
    });

    // Attach event listeners after rows are added
    document.querySelectorAll(".approve-btn").forEach(btn => {
      btn.addEventListener("click", () => submitDecision(btn.dataset.id, "approve"));
    });

    document.querySelectorAll(".reject-btn").forEach(btn => {
      btn.addEventListener("click", () => submitDecision(btn.dataset.id, "decline"));
    });

    statusText.textContent = "";
  } catch (err) {
    console.error(err);
    statusText.textContent = "Error loading reviews";
  }
}

async function submitDecision(transactionId, decision) {
  if (!confirm(`${decision === "approve" ? "Approve" : "Reject"} this transaction?`)) return;

  try {
    const res = await fetch(`/api/v1/reviews/${transactionId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        reviewerId: "reviewer-1",
        reason: "" // optional, can add text input later
      })
    });

    const json = await res.json();
    if (!json.success) throw new Error("API failure");

    // reload table after decision
    loadReviews();
  } catch (err) {
    alert(`Failed to ${decision} transaction`);
    console.error(err);
  }
}

// Automatically load reviews on page load
window.addEventListener("DOMContentLoaded", loadReviews);

// Optional: add refresh button functionality if you have one
const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", loadReviews);
}