import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// ── Config ─────────────────────────────────────────────────────────────────
const config = new pulumi.Config();

// Secrets – set via: pulumi config set --secret <key> <value>
const openaiApiKey = config.requireSecret("openaiApiKey");
const amadeusApiKey = config.requireSecret("amadeusApiKey");
const amadeusApiSecret = config.requireSecret("amadeusApiSecret");
const googleMapsApiKey = config.requireSecret("googleMapsApiKey");
const unsplashAccessKey = config.requireSecret("unsplashAccessKey");
const databaseUrl = config.requireSecret("databaseUrl");
const clerkPublishableKey = config.requireSecret("clerkPublishableKey");
const clerkSecretKey = config.requireSecret("clerkSecretKey");

// Optional: your SSH key pair name (for debugging). Skip if you don't need SSH.
const keyPairName = config.get("keyPairName"); // e.g. "my-laptop"

// ── Security Group ─────────────────────────────────────────────────────────
const sg = new aws.ec2.SecurityGroup("travel-app-sg", {
  description: "Allow HTTP, HTTPS, and SSH",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTP",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTPS",
    },
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
      description: "SSH",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "All outbound",
    },
  ],
});

// ── IAM Role (SSM access for remote management without SSH) ────────────────
const role = new aws.iam.Role("travel-app-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "ec2.amazonaws.com" },
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment("ssm-policy", {
  role: role.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});

const instanceProfile = new aws.iam.InstanceProfile("travel-app-profile", {
  role: role.name,
});

// ── User-data script ───────────────────────────────────────────────────────
// Runs once on first boot: installs Docker + Compose, writes env files, starts app
const userData = pulumi
  .all([
    openaiApiKey,
    amadeusApiKey,
    amadeusApiSecret,
    googleMapsApiKey,
    unsplashAccessKey,
    databaseUrl,
    clerkPublishableKey,
    clerkSecretKey,
  ])
  .apply(
    ([
      openai,
      amadeus,
      amadeusSecret,
      gmaps,
      unsplash,
      dbUrl,
      clerkPub,
      clerkSec,
    ]) => {
      // Build the script, then strip any \r so CRLF from Windows doesn't break #!/bin/bash
      const script = `#!/bin/bash
exec > /var/log/user-data.log 2>&1
set -x
echo "=== START user-data at $(date) ==="

echo "=== Creating 2 GB swap ==="
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab

echo "=== Installing Docker ==="
dnf install -y docker git || yum install -y docker git
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

echo "=== Installing Docker Compose v2 ==="
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.2/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

echo "=== Cloning repo ==="
cd /home/ec2-user
git clone https://github.com/taroserigano/S3-File-uploadingsz_--.git app
cd app

echo "=== Writing backend .env ==="
cat > agentic-service/.env <<'ENVEOF'
OPENAI_API_KEY=${openai}
AMADEUS_API_KEY=${amadeus}
AMADEUS_API_SECRET=${amadeusSecret}
GOOGLE_MAPS_API_KEY=${gmaps}
UNSPLASH_ACCESS_KEY=${unsplash}
ENVEOF

echo "=== Writing frontend .env.local ==="
cat > .env.local <<'ENVEOF'
DATABASE_URL=${dbUrl}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${clerkPub}
CLERK_SECRET_KEY=${clerkSec}
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${gmaps}
AGENTIC_SERVICE_URL=http://backend:8000
VAULT_API_URL=https://2avgmrr36j.execute-api.us-east-1.amazonaws.com/dev
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/planner
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/planner
ENVEOF

echo "=== Building & starting with Docker Compose ==="
chown -R ec2-user:ec2-user /home/ec2-user/app
docker compose up -d --build 2>&1

echo "=== Setting up Nginx reverse proxy (port 80 -> 3000) ==="
dnf install -y nginx || yum install -y nginx

cat > /etc/nginx/conf.d/travel-app.conf <<'NGINXEOF'
server {
    listen 80;
    server_name _;

    # Trust CloudFront's forwarded headers
    real_ip_header X-Forwarded-For;
    set_real_ip_from 0.0.0.0/0;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
NGINXEOF

rm -f /etc/nginx/conf.d/default.conf
systemctl enable nginx
systemctl start nginx

echo "=== Docker status ==="
docker ps
echo "=== DONE user-data at $(date) ==="
`;
      return script.replace(/\r/g, "");
    },
  );

// ── Look up latest Amazon Linux 2023 AMI ───────────────────────────────────
const ami = aws.ec2.getAmi({
  mostRecent: true,
  owners: ["amazon"],
  filters: [
    { name: "name", values: ["al2023-ami-*-x86_64"] },
    { name: "virtualization-type", values: ["hvm"] },
  ],
});

// ── EC2 Instance (t3.micro = AWS Free Tier for 12 months) ──────────────────
const instance = new aws.ec2.Instance("travel-app", {
  instanceType: "t3.micro",
  ami: ami.then((a) => a.id),
  vpcSecurityGroupIds: [sg.id],
  iamInstanceProfile: instanceProfile.name,
  keyName: keyPairName,
  userData: userData,
  rootBlockDevice: {
    volumeSize: 30, // 30 GB gp3 (free tier includes 30 GB)
    volumeType: "gp3",
  },
  tags: { Name: "travel-app" },
});

// ── Elastic IP (free when attached to a running instance) ──────────────────
const eip = new aws.ec2.Eip("travel-app-eip", {
  instance: instance.id,
  tags: { Name: "travel-app" },
});

// ── CloudFront Distribution (free HTTPS via *.cloudfront.net cert) ─────────
const cloudfront = new aws.cloudfront.Distribution("travel-app-cdn", {
  enabled: true,
  comment: "HTTPS termination for travel-app EC2",

  // Origin: the EC2 Elastic IP over HTTP
  origins: [
    {
      domainName: eip.publicDns, // e.g. ec2-1-2-3-4.compute-1.amazonaws.com
      originId: "ec2Origin",
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "http-only", // EC2 only serves HTTP
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],

  defaultCacheBehavior: {
    targetOriginId: "ec2Origin",
    viewerProtocolPolicy: "redirect-to-https", // Force HTTPS for visitors

    allowedMethods: [
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "PATCH",
      "POST",
      "PUT",
    ],
    cachedMethods: ["GET", "HEAD"],

    // Forward everything – this is a dynamic Next.js app, not a static site
    forwardedValues: {
      queryString: true,
      headers: ["*"], // Forward all headers so Next.js SSR works
      cookies: { forward: "all" },
    },

    minTtl: 0,
    defaultTtl: 0,
    maxTtl: 0, // No caching – let Next.js control Cache-Control
    compress: true, // Gzip/Brotli for free
  },

  // Use the default CloudFront certificate (*.cloudfront.net)
  viewerCertificate: {
    cloudfrontDefaultCertificate: true,
  },

  restrictions: {
    geoRestriction: {
      restrictionType: "none",
    },
  },

  // Next.js returns its own 404/500 pages
  priceClass: "PriceClass_100", // US + Europe edges (cheapest)

  tags: { Name: "travel-app-cdn" },
});

// ── Stack outputs ──────────────────────────────────────────────────────────
export const publicIp = eip.publicIp;
export const publicDns = eip.publicDns;
export const appUrl = pulumi.interpolate`https://${cloudfront.domainName}`;
export const cloudfrontDomain = cloudfront.domainName;
export const cloudfrontDistributionId = cloudfront.id;
export const directHttpUrl = pulumi.interpolate`http://${eip.publicIp}`;
export const sshCommand = pulumi.interpolate`ssh -i ~/.ssh/${keyPairName || "your-key"}.pem ec2-user@${eip.publicIp}`;
