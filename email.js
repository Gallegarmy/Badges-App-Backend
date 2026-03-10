import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendResetEmail(email, link) {

  try {

    const response = await resend.emails.send({
      from: process.env.AUTH_ADDRESS,
      to: email,
      subject: "Restaura tu contraseña",
      html: `
        <h2>Reinicia tu contraseña</h2>
        <p>Haz click en el link debajo para resetear tu contraseña:</p>
        <a href="${link}">${link}</a>
        <p>Este link expira en 15 minutos.</p>
      `
    });

    console.log("Email sent:", response);

  } catch (error) {

    console.error("Resend error:", error);

  }

}