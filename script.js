const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const contactForm = document.querySelector("#contact-form");
const formNote = document.querySelector("#form-note");

menuToggle?.addEventListener("click", () => {
  const isOpen = mainNav?.classList.toggle("is-open") ?? false;
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

mainNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitButton = contactForm.querySelector("button[type='submit']");
  const formData = new FormData(contactForm);
  const payload = {
    name: formData.get("name"),
    contact: formData.get("contact"),
    message: formData.get("message"),
    website: formData.get("website") || "",
  };

  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = true;
    submitButton.textContent = "发送中...";
  }
  formNote.textContent = "";

  fetch("/api/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || "提交失败，请稍后再试。");
      formNote.textContent = "已收到你的想法，我们会尽快与你联系。";
      contactForm.reset();
    })
    .catch((error) => {
      formNote.textContent = error instanceof Error ? error.message : "当前无法连接服务，请稍后再试。";
    })
    .finally(() => {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.innerHTML = "发送给天饺 <span>↗</span>";
      }
    });
});
