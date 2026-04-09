import { Router, type IRouter } from "express";
import { adminAuth } from "./admin-shared.js";
import authRoutes from "./admin/auth.js";
import usersRoutes from "./admin/users.js";
import ordersRoutes from "./admin/orders.js";
import ridesRoutes from "./admin/rides.js";
import financeRoutes from "./admin/finance.js";
import contentRoutes from "./admin/content.js";
import systemRoutes from "./admin/system.js";
import serviceZonesRoutes from "./admin/service-zones.js";
import deliveryAccessRoutes from "./admin/delivery-access.js";
import conditionsRoutes from "./admin/conditions.js";
import wishlistsRoutes from "./admin/wishlists.js";
import pharmacyAdminRoutes from "./admin/pharmacy.js";
import deletionRequestsRoutes from "./admin/deletion-requests.js";
import ridersAdminRoutes from "./admin/riders.js";

export {
  DEFAULT_PLATFORM_SETTINGS,
  ensureAuthMethodColumn,
  ensureRideBidsMigration,
  ensureOrdersGpsColumns,
  ensureIdempotencyTable,
  ensureWalletNormalizedTxId,
  ensureOtpSettings,
  getPlatformSettings,
  getAdminSecret,
  adminAuth,
  DEFAULT_RIDE_SERVICES,
  ensureDefaultRideServices,
  ensureDefaultLocations,
  ensureDefaultServiceZones,
  ensureDefaultPaymentMethods,
  type AdminRequest,
} from "./admin-shared.js";

const router: IRouter = Router();

router.use(authRoutes);

router.use(adminAuth);

router.use(usersRoutes);
router.use(ordersRoutes);
router.use(ridesRoutes);
router.use(financeRoutes);
router.use(contentRoutes);
router.use(systemRoutes);
router.use("/service-zones", serviceZonesRoutes);
router.use(deliveryAccessRoutes);
router.use(conditionsRoutes);
router.use(wishlistsRoutes);
router.use(pharmacyAdminRoutes);
router.use(deletionRequestsRoutes);
router.use(ridersAdminRoutes);

export default router;
