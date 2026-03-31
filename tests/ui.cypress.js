 describe('UNIO Frontend - User Authentication', () => {
    beforeEach(() => {
        cy.visit('/'); // Visit the homepage
    });

    it('TC-15: Should display login page correctly', () => {
        cy.visit('/login.html');
        cy.get('input[name="email"]').should('be.visible');
        cy.get('input[name="password"]').should('be.visible');
        cy.get('button').contains('Login').should('be.visible');
    });

    it('TC-17: Should show error for invalid inputs', () => {
        cy.visit('/login.html');
        cy.get('input[name="email"]').type('invalid@test.com');
        cy.get('input[name="password"]').type('wrongpassword');
        cy.get('button').contains('Login').click();
        
        // Assuming your app shows an alert or a message
        cy.on('window:alert', (str) => {
            expect(str).to.equal('Invalid credentials');
        });
    });
});
