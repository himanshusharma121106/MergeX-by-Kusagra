import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/store";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { AlertCircle, Mail, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import logo from "@/assets/pg-logo.png";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Resend cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (user) {
    return <Navigate to={user.role === "operator" ? "/scan" : "/dashboard"} replace />;
  }

  // Step 1: Request OTP email
  const handleSendOtp = async (targetEmail = email) => {
    setErr("");
    setInfo("");
    const cleanEmail = targetEmail.trim().toLowerCase();

    if (!cleanEmail) {
      setErr("Please enter your corporate email address.");
      return;
    }

    if (!cleanEmail.endsWith("@pgel.in")) {
      setErr("Access restricted: Only authorized @pgel.in email addresses are permitted.");
      return;
    }

    setLoading(true);
    try {
      const res = await db.sendOtpAsync(cleanEmail);
      setLoading(false);

      if (!res.success) {
        setErr(res.message || "Failed to send verification code. Please check your email or contact IT.");
        return;
      }

      if (res.token) {
        setOtpToken(res.token);
      }

      setStep("otp");
      setOtp("");
      setCooldown(30);
      setInfo(`A 6-digit verification code has been sent to ${cleanEmail}`);
    } catch (e: unknown) {
      setLoading(false);
      setErr(e instanceof Error ? e.message : "Network error. Please try again.");
    }
  };

  // Step 2: Verify OTP and log in
  const handleVerifyOtp = async (otpToVerify = otp) => {
    setErr("");
    setInfo("");

    if (!otpToVerify || otpToVerify.length < 6) {
      setErr("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    try {
      const res = await db.verifyOtpAsync(email.trim().toLowerCase(), otpToVerify, otpToken);
      setLoading(false);

      if (!res.success || !res.user) {
        setErr(res.message || "Invalid or expired verification code.");
        return;
      }

      login(res.user);
      nav(res.user.role === "operator" ? "/scan" : "/dashboard");
    } catch (e: unknown) {
      setLoading(false);
      setErr(e instanceof Error ? e.message : "Verification failed. Please try again.");
    }
  };

  // Auto-verify when 6 digits are entered
  const handleOtpChange = (val: string) => {
    setOtp(val);
    if (val.length === 6) {
      handleVerifyOtp(val);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-50 flex items-center justify-center p-4">
      {/* Light modern enterprise background blobs */}
      <div className="absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full bg-blue-100/60 blur-[100px]" />
      <div className="absolute -bottom-32 -left-32 h-[420px] w-[420px] rounded-full bg-slate-200/60 blur-[100px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,#f8fafc_100%)] opacity-85" />

      <div className="relative w-full max-w-sm">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-white shadow-xl shadow-blue-900/5 border border-slate-100 mb-3 p-2.5">
            <img src={logo} alt="PG Group" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">MergeX</h1>
          <p className="text-xs text-slate-500 mt-1 tracking-wide uppercase font-medium">
            PG GROUP · Secure OTP Verification
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50 p-6 sm:p-7">
          {step === "email" ? (
            <div>
              <div className="mb-5">
                <h2 className="text-lg font-bold text-slate-800">Passwordless Sign In</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your registered PG Group email. We will send a secure verification code to your inbox.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendOtp();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-slate-600 text-[10px] uppercase tracking-wider font-semibold">
                    Corporate Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@pgel.in"
                      className="h-10 pl-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-600 transition-shadow text-sm"
                      required
                    />
                  </div>
                </div>

                {err && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 animate-in fade-in">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-10 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 transition-all mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Checking Database & Sending...
                    </>
                  ) : (
                    "Send Verification Code"
                  )}
                </Button>
              </form>
            </div>
          ) : (
            <div>
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setErr("");
                    setInfo("");
                  }}
                  className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-700 mb-2 transition-colors"
                >
                  <ArrowLeft className="h-3 w-3 mr-1" /> Change Email
                </button>
                <h2 className="text-lg font-bold text-slate-800">Enter Verification Code</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Sent to <span className="font-semibold text-slate-700">{email}</span> via Outlook. Code is valid for 10 minutes.
                </p>
              </div>

              {info && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 mb-4 animate-in fade-in">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
                  <span>{info}</span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyOtp();
                }}
                className="space-y-4"
              >
                <div className="flex flex-col items-center justify-center space-y-2 py-2">
                  <InputOTP maxLength={6} value={otp} onChange={handleOtpChange} autoFocus>
                    <InputOTPGroup className="gap-1.5 sm:gap-2">
                      <InputOTPSlot index={0} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                      <InputOTPSlot index={1} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                      <InputOTPSlot index={2} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                      <InputOTPSlot index={3} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                      <InputOTPSlot index={4} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                      <InputOTPSlot index={5} className="h-12 w-10 sm:h-12 sm:w-11 text-lg font-bold border-slate-300 rounded-lg bg-slate-50 focus:bg-white" />
                    </InputOTPGroup>
                  </InputOTP>
                  <p className="text-[11px] text-slate-400">Enter the 6-digit code from your email</p>
                </div>

                {err && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 animate-in fade-in">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || otp.length < 6}
                  className="w-full h-10 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Verifying...
                    </>
                  ) : (
                    "Verify & Sign In"
                  )}
                </Button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    disabled={cooldown > 0 || loading}
                    onClick={() => handleSendOtp(email)}
                    className="text-xs text-slate-500 hover:text-blue-600 font-medium disabled:opacity-50 disabled:hover:text-slate-500 transition-colors"
                  >
                    {cooldown > 0 ? (
                      `Resend code in ${cooldown}s`
                    ) : (
                      "Didn't receive the code? Resend OTP"
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>

        <p className="text-center text-[10px] text-slate-400 mt-4 font-medium">
          © {new Date().getFullYear()} PG Group · Enterprise QR Platform
        </p>
      </div>
    </div>
  );
}
