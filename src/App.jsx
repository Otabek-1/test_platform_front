import { Angry, CheckCheckIcon, CheckLine, CircleQuestionMark, FileQuestionIcon, LeafyGreen, Paperclip, Wheat } from "lucide-react";
import React, { useEffect, useState, useRef } from "react";
import NotoSans from "../public/fonts/NotoSans-Regular.ttf";

/**
 * App.jsx
 * - Light mode only
 * - One Finish button (footer). When clicked -> confirm -> finish
 * - Test details NOT shown on finished screen (only score/summary briefly)
 * - PDF generated on frontend using jsPDF + html2canvas and sent as FormData to /submit
 * - PDF filename: <safeFullName>_YYYYMMDD-HHMM.pdf
 * - PDF sent as File with MIME "application/pdf"
 *
 * Endpoints (assumed):
 * POST https://otabek.alwaysdata.net/verify  -> { access: true|false } (we send { code, name })
 * GET  https://otabek.alwaysdata.net/tests?limit=25 -> array of tests { id, question, options[], answer }
 * POST https://otabek.alwaysdata.net/submit -> accepts multipart/form-data file field "file" and meta fields
 *
 * Install: npm i jspdf html2canvas
 */

export default function App() {
  // UI states
  const [step, setStep] = useState("verify"); // verify, rules, running, finished
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [tests, setTests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // {testId: selectedOption}
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);
  const [durationSec, setDurationSec] = useState(60 * 60); // 60 minutes
  const [timeLeft, setTimeLeft] = useState(60 * 60);
  const [violations, setViolations] = useState(0);
  const [showVerifyError, setShowVerifyError] = useState("");
  const timerRef = useRef(null);
  const visibilityWarningsRef = useRef(0);

  // VERIFY (send name+code for clarity)
  const handleVerify = async () => {
    setShowVerifyError("");
    if (!name.trim()) {
      setShowVerifyError("Iltimos to'liq ismingizni kiriting.");
      return;
    }
    try {
      const res = await fetch("https://otabek.alwaysdata.net/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (data && data.access) {
        setStep("rules");
      } else {
        setShowVerifyError("Invalid code or access denied.");
      }
    } catch (e) {
      setShowVerifyError("Network error. Try again.");
    }
  };

  // START TEST
  const startTest = async () => {
    try {
      const q = new URLSearchParams({ limit: 25 });
      const res = await fetch(`https://otabek.alwaysdata.net/tests?${q.toString()}`);
      if (!res.ok) throw new Error("Failed to load tests");
      const arr = await res.json();
      setTests(Array.isArray(arr) ? arr : []);
      setStartedAt(new Date().toISOString());
      setTimeLeft(60 * 60);
      setDurationSec(60 * 60);
      setCurrentIndex(0);
      setAnswers({});
      setViolations(0);
      setStep("running");

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            finishByTimeout();
            return 0;
          }
          return t - 1;
        });
      }, 1000);

      window.addEventListener("beforeunload", beforeUnloadHandler);
      document.addEventListener("visibilitychange", visibilityHandler);
    } catch (e) {
      alert("Failed to load tests");
    }
  };

  const visibilityHandler = () => {
    if (document.hidden) {
      visibilityWarningsRef.current += 1;
      setViolations((v) => v + 1);
      // Use confirm-like warning but keep it simple
      // small alert is acceptable for tests
      alert("Ogohlantirish: siz test oynasidan chiqdingiz, test jarayonida boshqa oyna yoki ilovaga o'tish mumkin emas.");
    }
  };

  const beforeUnloadHandler = (e) => {
    e.preventDefault();
    e.returnValue =
      "Refreshing or leaving will submit your test and may be considered a violation.";
  };

  useEffect(() => {
    // cleanup on unmount
    return () => {
      document.removeEventListener("visibilitychange", visibilityHandler);
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectOption = (testId, option) => {
    setAnswers((prev) => ({ ...prev, [testId]: option }));
  };

  const goNext = () => {
    if (currentIndex < tests.length - 1) setCurrentIndex((i) => i + 1);
  };
  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  // User clicked Finish (manual)
  const handleFinish = async () => {
    const ok = window.confirm("Haqiqatan ham testni tugatmoqchimisiz?");
    if (!ok) return;
    // Stop and submit
    if (timerRef.current) clearInterval(timerRef.current);
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    document.removeEventListener("visibilitychange", visibilityHandler);
    setFinishedAt(new Date().toISOString());
    setStep("finished");

    // generate and send PDF
    setTimeout(() => {
      createAndSendPDF();
    }, 400);
  };

  // Auto finish when time ends
  const finishByTimeout = () => {
    // No confirm on timeout
    if (timerRef.current) clearInterval(timerRef.current);
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    document.removeEventListener("visibilitychange", visibilityHandler);
    setFinishedAt(new Date().toISOString());
    setStep("finished");
    setTimeout(() => {
      createAndSendPDF();
    }, 400);
  };

  // create PDF and send to backend
  const createAndSendPDF = async () => {
    try {
      // 🔹 Lazy import jsPDF (bundle hajmini kamaytirish uchun)
      const { jsPDF } = await import("jspdf");

      // 🔹 Fontni jsPDF’ga qo‘shish
      const doc = new jsPDF({ unit: "px", format: "a4" });
      // 🔹 Test natijalari
      const total = tests.length;
      let correct = 0;

      const rows = tests
        .map((t, i) => {
          const userAnswer = answers[t.id];
          const isCorrect = userAnswer === t.answer;
          if (isCorrect) correct++;
          return `${i + 1}. ${t.question}\nTanlangan javob: ${userAnswer || "-"
            }\nTo‘g‘ri javob: ${t.answer}\n\n`;
        })
        .join("");

      // 🔹 Vaqt va davomiylik
      const started = startedAt || new Date().toISOString();
      const finished = new Date().toISOString();
      const durationSeconds = (new Date(finished) - new Date(started)) / 1000;
      const mins = Math.floor(durationSeconds / 60);
      const secs = Math.floor(durationSeconds % 60);
      const duration = `${mins}m ${secs}s`;

      // 🔹 Fayl nomi
      const dt = new Date(finished);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0");
      const min = String(dt.getMinutes()).padStart(2, "0");
      const safeName = (name || "user")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^\w\-]/g, "");
      const filename = `${safeName}_${yyyy}${mm}${dd}-${hh}${min}.pdf`;

      // 📄 PDF kontent
      let y = 30;
      doc.setFontSize(14);
      doc.text("🧠 Test natijalari", 20, y);
      y += 20;

      doc.setFontSize(12);
      doc.text(`Ism: ${name}`, 20, y); y += 16;
      doc.text(`Boshlangan vaqt: ${started}`, 20, y); y += 16;
      doc.text(`Tugagan vaqt: ${finished}`, 20, y); y += 16;
      doc.text(`Davomiylik: ${duration}`, 20, y); y += 16;
      doc.text(`Ball: ${correct} / ${total}`, 20, y); y += 20;

      // 🔹 Sahifalarga bo‘lish
      const pageHeight = doc.internal.pageSize.getHeight();
      const split = doc.splitTextToSize(rows, 400);

      for (let i = 0; i < split.length; i++) {
        if (y > pageHeight - 40) {
          doc.addPage();
          y = 30;
        }
        doc.text(split[i], 20, y);
        y += 14;
      }

      // 📦 Blob yaratish
      const pdfBlob = doc.output("blob");
      const file = new File([pdfBlob], filename, { type: "application/pdf" });

      // 🔄 Backendga yuborish
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name);
      fd.append("startedAt", started);
      fd.append("finishedAt", finished);
      fd.append("duration", duration);
      fd.append("total", total.toString());
      fd.append("correct", correct.toString());

      const res = await fetch("https://otabek.alwaysdata.net/submit", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => null);
        console.error("Submit failed:", res.status, text);
        alert("❌ Test natijasi yuborilmadi. Qayta urinib ko‘ring.");
      } else {
        console.log("✅ PDF muvaffaqiyatli yuborildi!");
        alert("✅ Test natijangiz yuborildi!");
      }

    } catch (err) {
      console.error("❌ PDF yaratish yoki yuborishda xatolik:", err);
      alert("PDF yaratishda yoki yuborishda xatolik yuz berdi!");
    }
  };



  const formatDuration = (secs) => {
    secs = Math.max(0, Math.round(secs || 0));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  const pad = (n) => String(n).padStart(2, "0");

  const escapeHtml = (str) => {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  };

  // UI components
  if (step === "verify") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-md bg-white p-6 rounded-lg shadow">
          <div className="text-center mb-4">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-green-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold">
              <Wheat className="scale-170" />
            </div>
            <p className="mt-3 text-lg text-gray-800">Don mutaxassislari  bilimlarini baholash platformasi</p>
          </div>

          <div className="space-y-3">
            <input
              className="w-full p-2 border border-gray-400 outline-none rounded-lg bg-gray-50"
              placeholder="To'liq ism- familya"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full p-2 border border-gray-400 outline-none rounded-lg bg-gray-50"
              placeholder="Access code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {showVerifyError && <div className="text-red-500 text-sm">{showVerifyError}</div>}
            <button className="w-full py-2 bg-indigo-600 text-white rounded" onClick={handleVerify}>
              Kirish
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "rules") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-2xl bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">Muhim qoidalar!</h2>
          <ul className="list-disc pl-5 text-sm text-gray-700">
            <li>Test davomiyligi: <strong>1 soat</strong>.</li>
            <li>Testlar soni: <strong>25</strong>.</li>
            <li>Test jarayonida boshqa oyna yoki brauzerga o'tmang.</li>
            <li>Test jarayonida brauzerni qayta yuklamang.</li>
          </ul>
          <div className="mt-6 flex justify-end">
            <button className="px-4 py-2 bg-gray-200 rounded mr-2" onClick={() => setStep("verify")}>
              Orqaga
            </button>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={startTest}>
              Boshlash
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "running") {
    const current = tests[currentIndex] || {};
    const total = tests.length;
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        {/* Navbar */}
        <nav className="flex items-center justify-between px-4 py-3 bg-white shadow">
          <div className="flex items-center gap-4">
            <div className="font-bold">Don mutaxassislari bilimlarini baholash platformasi</div>
            <div className="text-sm text-gray-600">{name}</div>
          </div>
          <div className="text-sm">
            Qolgan vaqt:{" "}
            <span className="font-mono">
              {pad(Math.floor(timeLeft / 3600))}:{pad(Math.floor((timeLeft % 3600) / 60))}:{pad(timeLeft % 60)}
            </span>
          </div>
        </nav>

        {/* Main */}
        <main className="flex-1 p-4 max-w-4xl mx-auto w-full">
          <div className="bg-white p-4 rounded shadow">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold">{currentIndex + 1} / {total}- savol</h3>
                <p className="mt-2 text-gray-700">{current.question}</p>
              </div>
              <div className="text-sm text-gray-500">
                Violations: <strong>{violations}</strong>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {(current.options || []).map((opt, i) => {
                const selected = answers[current.id] === opt;
                return (
                  <button
                    key={i}
                    onClick={() => selectOption(current.id, opt)}
                    className={`text-left p-3 rounded border ${selected ? "border-indigo-500 bg-indigo-50" : ""}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex justify-between">
              <div>
                <button className="px-3 py-1 mr-2 border rounded" onClick={goPrev} disabled={currentIndex === 0}>
                  Oldingi
                </button>
                <button className="px-3 py-1 border rounded" onClick={goNext} disabled={currentIndex === total - 1}>
                  Keyingi
                </button>
              </div>

              {/* removed duplicate finish -- only one finish (in footer) */}
              <div className="text-sm text-gray-500">Savollar: {total}</div>
            </div>
          </div>

          {/* question quick jump list (kept as requested) */}
          <div className="mt-4 grid grid-cols-5 gap-2">
            {tests.map((t, idx) => {
              const answered = answers[t.id] !== undefined;
              return (
                <button
                  key={t.id}
                  onClick={() => setCurrentIndex(idx)}
                  className={`p-2 rounded ${answered ? "bg-green-100" : "bg-gray-100"}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </main>

        {/* Footer with single Finish button */}
        <footer className="p-4 bg-white shadow">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div className="text-sm text-gray-600">{name} — {tests.length} questions</div>
            <div>
              <button className="px-4 py-2 bg-red-600 text-white rounded" onClick={handleFinish}>
                Tugatish
              </button>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // finished screen — DO NOT show per-question details (only summary)
  if (step === "finished") {
    // compute score (but do not render per-question details)
    const total = tests.length;
    let correct = 0;
    tests.forEach((t) => {
      if (answers[t.id] === t.answer) correct++;
    });

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-2xl bg-white p-6 rounded shadow text-center">
          <h2 className="text-xl font-bold">Test muvaffaqiyatli yakunlandi!</h2>
          <p className="mt-2">Test natijalaringiz avtomatik qabul qilindi va jo'natildi.</p>
          <p className="mt-2 text-sm text-gray-600">Natija: {correct} / {total}</p>
        </div>
      </div>
    );
  }

  return null;
}
