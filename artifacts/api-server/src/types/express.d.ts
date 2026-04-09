import type { InferSelectModel } from "drizzle-orm";
import type { ridesTable, usersTable } from "@workspace/db/schema";

type UserRow = InferSelectModel<typeof usersTable>;

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
      customerPhone?: string;
      customerUser?: UserRow;
      vendorId?: string;
      vendorUser?: UserRow & { storeName?: string | null };
      riderId?: string;
      riderUser?: UserRow & { vehicleType?: string | null };
      adminId?: string;
      adminRole?: string;
      adminName?: string;
      adminIp?: string;
      ride?: InferSelectModel<typeof ridesTable>;
    }
  }
}
