const PaymentSystem = {
    init: function () {
        console.log('Payment System Initialized');
    },

    /**
     * Initiate payment process
     * @param {Object} data { split_id, booking_id, amount, method }
     * @returns {Promise}
     */
    initiate: async function (data) {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                throw new Error('User not authenticated');
            }

            const response = await fetch('/api/payments/initiate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'Failed to initiate payment');
            }

            return result;
        } catch (error) {
            console.error('Payment initiation error:', error);
            throw error;
        }
    },

    /**
     * Show the payment modal with QR code
     * @param {Object} paymentData { paymentId, confirmationId, qrCodeData, amount }
     * @param {Function} onConfirm Callback when payment is manually confirmed
     * @param {Function} onCancel Callback when payment is cancelled via modal closure
     */
    showModal: function (paymentData, onConfirm, onCancel) {
        // Remove existing modal if any
        const existingModal = document.getElementById('payment-system-modal');
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div id="payment-system-modal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                <div class="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
                    <!-- Header -->
                    <div class="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                        <h3 class="text-xl font-bold text-slate-900 dark:text-white">Complete Payment</h3>
                        <button onclick="document.getElementById('payment-system-modal').remove()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <!-- Content -->
                    <div class="p-8 text-center">
                        <div class="mb-6">
                            <p class="text-slate-500 dark:text-slate-400 mb-1">Amount to Pay</p>
                            <p class="text-4xl font-black text-slate-900 dark:text-white">₹${parseFloat(paymentData.amount).toFixed(2)}</p>
                        </div>

                        <div class="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-6 mb-6">
                            <div class="bg-white p-4 rounded-xl inline-block mb-4 shadow-sm">
                                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentData.qrCodeData)}" alt="Scan to Pay" class="w-48 h-48 object-contain">
                            </div>
                            <p class="text-sm text-slate-600 dark:text-slate-400 mb-4">Scan QR with any payment app or use the confirmation button below</p>
                            
                            <div class="flex flex-col gap-2">
                                <a href="${paymentData.qrCodeData}" target="_blank" class="text-xs text-primary hover:underline font-medium">
                                    Simulate phone scan (Open link)
                                </a>
                            </div>
                        </div>

                        <div class="space-y-3">
                            <button id="confirm-payment-btn" class="w-full py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all flex items-center justify-center gap-2">
                                <span class="material-symbols-outlined">check_circle</span>
                                I've Completed Payment
                            </button>
                            <p class="text-xs text-slate-400">Confirmation ID: ${paymentData.confirmationId}</p>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="p-4 bg-slate-50 dark:bg-slate-900/30 text-center">
                        <p class="text-xs text-slate-500">This is a secure dummy payment system</p>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const btn = document.getElementById('confirm-payment-btn');
        // Start with button DISABLED — must scan QR first
        btn.disabled = true;
        btn.classList.remove('bg-primary', 'hover:bg-primary/90');
        btn.classList.add('bg-slate-500', 'cursor-not-allowed', 'opacity-60');
        btn.innerHTML = '<span class="material-symbols-outlined">qr_code_scanner</span> Scan QR Code First';

        // Poll for scan status every 2 seconds
        const pollInterval = setInterval(async () => {
            try {
                const token = localStorage.getItem('token');
                const statusRes = await fetch(`/api/payments/status/${paymentData.paymentId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.status === 'scanned' || statusData.status === 'completed') {
                        clearInterval(pollInterval);
                        btn.disabled = false;
                        btn.classList.remove('bg-slate-500', 'cursor-not-allowed', 'opacity-60');
                        btn.classList.add('bg-primary', 'hover:bg-primary/90');
                        btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> I\'ve Completed Payment';
                    }
                }
            } catch (e) {
                // Ignore poll errors
            }
        }, 2000);

        // Clean up polling when modal is closed
        const modal = document.getElementById('payment-system-modal');
        const closeBtn = modal.querySelector('button[onclick*="remove"]');
        if (closeBtn) {
            closeBtn.removeAttribute('onclick');
            closeBtn.addEventListener('click', () => {
                clearInterval(pollInterval);
                modal.remove();
                if (onCancel) onCancel(paymentData);
            });
        }

        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin material-symbols-outlined">sync</span> Confirming...';

            try {
                const success = await this.confirm(paymentData.paymentId, paymentData.confirmationId);
                if (success) {
                    clearInterval(pollInterval);
                    document.getElementById('payment-system-modal').remove();
                    if (onConfirm) onConfirm(paymentData);
                }
            } catch (error) {
                alert('Confirmation failed: ' + error.message);
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> I\'ve Completed Payment';
            }
        });
    },

    /**
     * Confirm a payment
     * @param {number} paymentId 
     * @param {string} confirmationId 
     * @returns {Promise<boolean>}
     */
    confirm: async function (paymentId, confirmationId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/payments/confirm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ paymentId, confirmationId })
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'Confirmation failed');
            }

            return true;
        } catch (error) {
            console.error('Payment confirmation error:', error);
            throw error;
        }
    }
};

window.PaymentSystem = PaymentSystem;
