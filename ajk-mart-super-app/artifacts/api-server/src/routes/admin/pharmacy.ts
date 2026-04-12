import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { pharmacyOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendSuccess, sendNotFound, sendValidationError } from "../../lib/response.js";
import { prescriptionRefMap } from "../uploads.js";
import { validateBody, validateParams } from "../../middleware/validate.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();

const prescriptionReviewSchema = z.object({
  action: z.enum(["approved", "rejected"], {
    errorMap: () => ({ message: "action must be 'approved' or 'rejected'" }),
  }),
  note: z.string().optional(),
}).strip();

const router = Router();

router.get("/pharmacy/:id/prescription", validateParams(idParamSchema), async (req, res) => {
  const orderId = req.params["id"]!;
  const [order] = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.id, orderId)).limit(1);
  if (!order) { sendNotFound(res, "Order not found"); return; }

  let noteText = order.prescriptionNote ?? null;
  let prescriptionPhotoUrl: string | null = null;

  if (noteText) {
    const photoMatch = noteText.match(/\[photo:\s*([^\]]+)\]/);
    if (photoMatch) {
      const raw = photoMatch[1]!.trim();
      if (raw.startsWith("rx-")) {
        prescriptionPhotoUrl = prescriptionRefMap.get(raw)?.url ?? null;
      } else {
        prescriptionPhotoUrl = raw;
      }
      noteText = noteText.replace(/\n?\[photo:\s*[^\]]+\]/, "").trim() || null;
    }
  }

  sendSuccess(res, {
    orderId: order.id,
    prescriptionNote: noteText,
    prescriptionPhotoUrl,
    prescriptionStatus: order.prescriptionStatus ?? "none",
  });
});

router.post("/pharmacy/:id/prescription/review", validateParams(idParamSchema), validateBody(prescriptionReviewSchema), async (req, res) => {
  const orderId = req.params["id"]!;
  const { action, note } = req.body as { action?: string; note?: string };

  if (!action || !["approved", "rejected"].includes(action)) {
    sendValidationError(res, "action must be 'approved' or 'rejected'");
    return;
  }

  const [order] = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.id, orderId)).limit(1);
  if (!order) { sendNotFound(res, "Order not found"); return; }

  const updates: Record<string, unknown> = {
    prescriptionStatus: action,
    updatedAt: new Date(),
  };

  if (note) {
    const existingNote = order.prescriptionNote || "";
    updates.prescriptionNote = existingNote
      ? `${existingNote}\n[Admin: ${note}]`
      : `[Admin: ${note}]`;
  }

  const [updated] = await db.update(pharmacyOrdersTable)
    .set(updates)
    .where(eq(pharmacyOrdersTable.id, orderId))
    .returning();

  sendSuccess(res, {
    orderId: updated!.id,
    prescriptionStatus: updated!.prescriptionStatus,
    message: `Prescription ${action}`,
  });
});

export default router;
