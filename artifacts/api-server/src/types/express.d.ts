declare namespace Express {
  interface Request {
    customerId?: string;
    customerPhone?: string;
    customerUser?: any;
    vendorId?: string;
    vendorUser?: any;
    riderId?: string;
    riderUser?: any;
    adminId?: string;
    adminRole?: string;
    adminName?: string;
    adminIp?: string;
  }
}
