import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const emailId = searchParams.get("emailId");

    if (emailId) {
      console.log(`[Diagnostic API] Fetching receiving email for emailId: ${emailId}`);
      const { data, error } = await resend.emails.receiving.get(emailId);
      
      if (error || !data) {
        return NextResponse.json({
          status: "ERROR",
          error: error || "No data returned",
          emailId
        }, { status: 400 });
      }

      const htmlBody = data.html || "";
      const textBody = data.text || "";
      const combinedBody = (textBody + "\n" + htmlBody)
        .replace(/=\r?\n/g, "")
        .replace(/(\r\n|\n|\r)/gm, " ")
        .replace(/&amp;/g, "&");

      const vfMatch = combinedBody.match(/https:\/\/[a-z0-9.-]*google\.com\/mail\/vf-[^\s"<>\n\r]+/i);
      const generalMatch = combinedBody.match(/https:\/\/[a-z0-9.-]*google\.com\/[^\s"<>\n\r]+/i);
      const confirmationUrl = vfMatch ? vfMatch[0] : (generalMatch ? generalMatch[0] : null);

      return NextResponse.json({
        status: "SUCCESS",
        emailId,
        metadata: {
          object: data.object,
          id: data.id,
          from: data.from,
          to: data.to,
          received_for: data.received_for,
          subject: data.subject,
          created_at: data.created_at,
          message_id: data.message_id,
          has_html: !!data.html,
          html_length: htmlBody.length,
          has_text: !!data.text,
          text_length: textBody.length,
          attachments_count: data.attachments?.length || 0,
          attachments: data.attachments || [],
          headers_present: !!data.headers,
          raw_present: !!data.raw,
          raw: data.raw || null
        },
        body_analysis: {
          text_snippet: textBody.slice(0, 500),
          html_snippet: htmlBody.slice(0, 500),
          confirmation_url_extracted: !!confirmationUrl,
          confirmation_url: confirmationUrl
        }
      });
    }

    // If no emailId provided, list the most recent receiving emails
    console.log("[Diagnostic API] Listing recent receiving emails from Resend");
    const { data: listData, error: listError } = await resend.emails.receiving.list();

    if (listError || !listData) {
      return NextResponse.json({
        status: "ERROR",
        error: listError || "Failed to list receiving emails"
      }, { status: 500 });
    }

    return NextResponse.json({
      status: "SUCCESS",
      count: listData.data?.length || 0,
      emails: listData.data || []
    });

  } catch (err: any) {
    console.error("[Diagnostic API Error]", err);
    return NextResponse.json({
      status: "EXCEPTION",
      error: err?.message || String(err)
    }, { status: 500 });
  }
}
